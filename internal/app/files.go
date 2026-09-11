package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

func validPath(p string) bool {
	return p != "" && len(p) < 4096 && !strings.ContainsRune(p, 0) && path.IsAbs(p)
}
func (s *Server) fileList(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	p := r.URL.Query().Get("path")
	if p == "" {
		var e error
		p, e = c.files.Getwd()
		if e != nil {
			fail(w, 502, "cannot resolve home directory")
			return
		}
	}
	if !validPath(p) {
		fail(w, 400, "absolute path required")
		return
	}
	entries, e := c.files.ReadDirContext(r.Context(), p)
	if e != nil {
		fail(w, 502, "cannot list directory; check permissions")
		return
	}
	type entry struct {
		Name        string    `json:"name"`
		Size        int64     `json:"size"`
		Mode        string    `json:"mode"`
		Permissions string    `json:"permissions"`
		Directory   bool      `json:"directory"`
		Symlink     bool      `json:"symlink"`
		Modified    time.Time `json:"modified"`
	}
	result := []entry{}
	for _, f := range entries {
		result = append(result, entry{f.Name(), f.Size(), f.Mode().String(), fmt.Sprintf("%04o", f.Mode().Perm()), f.IsDir(), f.Mode()&os.ModeSymlink != 0, f.ModTime()})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Directory != result[j].Directory {
			return result[i].Directory
		}
		return result[i].Name < result[j].Name
	})
	respond(w, 200, map[string]any{"path": p, "entries": result})
}
func (s *Server) fileOp(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	var v struct {
		Operation   string `json:"operation"`
		Path        string `json:"path"`
		Target      string `json:"target"`
		Permissions string `json:"permissions"`
	}
	if !decode(w, r, &v) {
		return
	}
	if !validPath(v.Path) || path.Clean(v.Path) == "/" {
		fail(w, 400, "invalid path")
		return
	}
	unlock := s.lockFile(c.hostID, v.Path)
	defer unlock()
	var e error
	switch v.Operation {
	case "mkdir":
		e = c.files.Mkdir(v.Path)
	case "create":
		var f io.Closer
		f, e = c.files.OpenFile(v.Path, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
		if e == nil {
			e = f.Close()
		}
	case "rename":
		if !validPath(v.Target) {
			fail(w, 400, "invalid target")
			return
		}
		e = c.files.Rename(v.Path, v.Target)
	case "delete":
		var f os.FileInfo
		f, e = c.files.Lstat(v.Path)
		if e == nil {
			if f.IsDir() {
				e = c.files.RemoveDirectory(v.Path)
			} else {
				e = c.files.Remove(v.Path)
			}
		}
	case "chmod":
		var n uint64
		n, e = strconv.ParseUint(v.Permissions, 8, 12)
		if e == nil && n <= 0777 {
			e = c.files.Chmod(v.Path, os.FileMode(n))
		} else {
			fail(w, 400, "permissions must be 0000–0777")
			return
		}
	default:
		fail(w, 400, "unknown file operation")
		return
	}
	if e != nil {
		fail(w, 409, "file operation failed; check permissions, conflicts or nonempty directory")
		return
	}
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	select {
	case s.transferSlots <- struct{}{}:
		defer func() { <-s.transferSlots }()
	case <-r.Context().Done():
		return
	}
	c := s.connection(w, r)
	if c == nil {
		return
	}
	p := r.URL.Query().Get("path")
	if !validPath(p) {
		fail(w, 400, "invalid path")
		return
	}
	f, e := c.files.Open(p)
	if e != nil {
		fail(w, 404, "file unavailable")
		return
	}
	defer f.Close()
	st, e := f.Stat()
	if e != nil || !st.Mode().IsRegular() {
		fail(w, 400, "regular file required")
		return
	}
	stop := context.AfterFunc(r.Context(), func() { f.Close() })
	defer stop()
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(p)}))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(st.Size(), 10))
	controller := http.NewResponseController(w)
	defer controller.SetWriteDeadline(time.Time{})
	io.Copy(&idleDownloadWriter{Writer: w, controller: controller}, f)
}
func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	select {
	case s.transferSlots <- struct{}{}:
		defer func() { <-s.transferSlots }()
	case <-r.Context().Done():
		return
	}
	c := s.connection(w, r)
	if c == nil {
		return
	}
	p := r.URL.Query().Get("path")
	overwrite := r.URL.Query().Get("overwrite") == "true"
	if !validPath(p) || path.Clean(p) == "/" {
		fail(w, 400, "invalid path")
		return
	}
	expected := r.ContentLength
	if declared := r.Header.Get("X-Upload-Size"); declared != "" {
		size, err := strconv.ParseInt(declared, 10, 64)
		if err != nil || size < 0 || (expected >= 0 && expected != size) {
			fail(w, 400, "invalid declared upload size")
			return
		}
		expected = size
	}
	if expected < 0 {
		fail(w, 411, "upload size is required")
		return
	}
	if expected > 2<<30 {
		fail(w, 413, "upload exceeds 2 GB")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2<<30)
	stopConnection := context.AfterFunc(c.ctx, func() { r.Body.Close() })
	defer stopConnection()
	controller := http.NewResponseController(w)
	defer controller.SetReadDeadline(time.Time{})
	temp := path.Join(path.Dir(p), ".remoter-"+token()+".tmp")
	f, e := c.files.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL)
	if e != nil {
		fail(w, 403, "cannot create upload; check permissions")
		return
	}
	defer c.files.Remove(temp)
	if e = f.Chmod(0600); e != nil {
		f.Close()
		fail(w, 502, "cannot secure temporary file")
		return
	}
	stop := context.AfterFunc(r.Context(), func() { f.Close() })
	defer stop()
	n, e := io.Copy(f, &idleUploadReader{Reader: r.Body, controller: controller})
	closeErr := f.Close()
	if e != nil || closeErr != nil || n != expected || r.Context().Err() != nil || c.ctx.Err() != nil {
		fail(w, 400, "upload interrupted or exceeds 2 GB")
		return
	}
	unlock := s.lockFile(c.hostID, p)
	defer unlock()
	if overwrite {
		if st, err := c.files.Stat(p); err == nil {
			c.files.Chmod(temp, st.Mode().Perm())
		}
		e = c.files.PosixRename(temp, p)
	} else {
		e = c.files.Rename(temp, p)
	}
	if e != nil {
		fail(w, 409, "destination exists or atomic rename unsupported")
		return
	}
	respond(w, 200, map[string]any{"bytes": n})
}
func (s *Server) readText(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	p := r.URL.Query().Get("path")
	if !validPath(p) {
		fail(w, 400, "invalid path")
		return
	}
	b, e := readSmall(c, p)
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	respond(w, 200, map[string]string{"content": string(b), "version": hashBytes(b)})
}
func readSmall(c *Connection, p string) ([]byte, error) {
	st, e := c.files.Lstat(p)
	if e != nil || !st.Mode().IsRegular() {
		return nil, errors.New("editor requires a regular file; resolve symbolic links explicitly")
	}
	f, e := c.files.Open(p)
	if e != nil {
		return nil, errors.New("file unavailable")
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if e != nil {
		return nil, errors.New("file read failed")
	}
	if len(b) > 1<<20 || !utf8.Valid(b) || strings.ContainsRune(string(b), 0) {
		return nil, errors.New("editor supports UTF-8 text up to 1 MB")
	}
	return b, nil
}
func hashBytes(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func (s *Server) writeText(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	var v struct {
		Path    string `json:"path"`
		Content string `json:"content"`
		Version string `json:"version"`
	}
	if !decodeLimit(w, r, &v, 8<<20) {
		return
	}
	if !validPath(v.Path) || len(v.Content) > 1<<20 || !utf8.ValidString(v.Content) || strings.ContainsRune(v.Content, 0) {
		fail(w, 400, "invalid text file")
		return
	}
	unlock := s.lockFile(c.hostID, v.Path)
	defer unlock()
	b, e := readSmall(c, v.Path)
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	if hashBytes(b) != v.Version {
		fail(w, 409, "file changed remotely; reload before saving")
		return
	}
	st, e := c.files.Stat(v.Path)
	if e != nil {
		fail(w, 404, "file unavailable")
		return
	}
	temp := path.Join(path.Dir(v.Path), ".remoter-edit-"+token())
	f, e := c.files.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if e != nil {
		fail(w, 403, "cannot write file")
		return
	}
	defer c.files.Remove(temp)
	if e = f.Chmod(st.Mode().Perm()); e == nil {
		_, e = io.WriteString(f, v.Content)
	}
	ce := f.Close()
	if e != nil || ce != nil {
		fail(w, 502, "write failed")
		return
	}
	b, e = readSmall(c, v.Path)
	if e != nil || hashBytes(b) != v.Version {
		fail(w, 409, "file changed remotely; reload before saving")
		return
	}
	if e = c.files.PosixRename(temp, v.Path); e != nil {
		fail(w, 502, "atomic save unsupported or permission denied")
		return
	}
	respond(w, 200, map[string]string{"version": hashBytes([]byte(v.Content))})
}

func (s *Server) lockFile(hostID, p string) func() {
	h := sha256.Sum256([]byte(hostID + ":" + path.Clean(p)))
	m := &s.fileLocks[int(h[0])%len(s.fileLocks)]
	m.Lock()
	return m.Unlock
}

type idleUploadReader struct {
	io.Reader
	controller *http.ResponseController
}

func (r *idleUploadReader) Read(p []byte) (int, error) {
	r.controller.SetReadDeadline(time.Now().Add(30 * time.Second))
	return r.Reader.Read(p)
}

type idleDownloadWriter struct {
	io.Writer
	controller *http.ResponseController
}

func (w *idleDownloadWriter) Write(p []byte) (int, error) {
	w.controller.SetWriteDeadline(time.Now().Add(30 * time.Second))
	return w.Writer.Write(p)
}
