package app

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"io"
	"net"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type Connection struct {
	id, userID, hostID, sessionHash string
	client                          *ssh.Client
	files                           *sftp.Client
	ctx                             context.Context
	cancel                          context.CancelFunc
	once                            sync.Once
	mu                              sync.Mutex
	terminalOpen                    bool
}

func (c *Connection) Close() { c.once.Do(func() { c.cancel(); c.client.Close() }) }

type fingerprintError struct{ value string }

func (e *fingerprintError) Error() string { return "host fingerprint requires verification" }
func (s *Server) dial(ctx context.Context, h Host, cred Credential, probe bool) (*ssh.Client, string, error) {
	var fp string
	auth := []ssh.AuthMethod{}
	if !probe {
		if h.AuthType == "key" {
			var signer ssh.Signer
			var e error
			if cred.Passphrase != "" {
				signer, e = ssh.ParsePrivateKeyWithPassphrase([]byte(cred.PrivateKey), []byte(cred.Passphrase))
			} else {
				signer, e = ssh.ParsePrivateKey([]byte(cred.PrivateKey))
			}
			if e != nil {
				return nil, "", errors.New("invalid private key or passphrase")
			}
			auth = append(auth, ssh.PublicKeys(signer))
		} else {
			if cred.Password == "" {
				return nil, "", errors.New("password required")
			}
			auth = append(auth, ssh.Password(cred.Password))
		}
	}
	cfg := &ssh.ClientConfig{User: h.Username, Auth: auth, Timeout: 12 * time.Second, HostKeyCallback: func(_ string, _ net.Addr, k ssh.PublicKey) error {
		fp = ssh.FingerprintSHA256(k)
		if probe || h.Fingerprint == "" || h.Fingerprint != fp {
			return &fingerprintError{fp}
		}
		return nil
	}}
	addr := net.JoinHostPort(h.Address, strconv.Itoa(h.Port))
	raw, e := safeDial(ctx, addr, "ssh", s.cfg.SSHAllowedCIDRs)
	if e != nil {
		return nil, "", e
	}
	raw.SetDeadline(time.Now().Add(12 * time.Second))
	cc, ch, req, e := ssh.NewClientConn(raw, addr, cfg)
	if e != nil {
		raw.Close()
		if fp != "" && (probe || fp != h.Fingerprint) {
			return nil, fp, &fingerprintError{fp}
		}
		return nil, fp, errors.New("SSH connection or authentication failed")
	}
	raw.SetDeadline(time.Time{})
	return ssh.NewClient(cc, ch, req), fp, nil
}
func (s *Server) probe(w http.ResponseWriter, r *http.Request) {
	h, _, e := s.loadHost(r, chi.URLParam(r, "id"))
	if e != nil {
		fail(w, 404, "host not found")
		return
	}
	if !s.allow("probe:"+uid(r), 30, time.Minute) {
		fail(w, 429, "too many probes")
		return
	}
	_, fp, e := s.dial(r.Context(), h, Credential{}, true)
	if fp == "" {
		fail(w, 502, e.Error())
		return
	}
	respond(w, 200, map[string]any{"fingerprint": fp, "previous": h.Fingerprint, "changed": h.Fingerprint != "" && h.Fingerprint != fp})
}
func (s *Server) trust(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Fingerprint string `json:"fingerprint"`
		Previous    string `json:"previous"`
	}
	if !decode(w, r, &in) {
		return
	}
	h, _, e := s.loadHost(r, chi.URLParam(r, "id"))
	if e != nil {
		fail(w, 404, "host not found")
		return
	}
	_, fp, _ := s.dial(r.Context(), h, Credential{}, true)
	if fp == "" || in.Fingerprint != fp || in.Previous != h.Fingerprint {
		fail(w, 409, "fingerprint changed; verify again")
		return
	}
	tag, e := s.db.Exec(r.Context(), "UPDATE hosts SET fingerprint=$1 WHERE id=$2 AND user_id=$3 AND fingerprint=$4", fp, h.ID, uid(r), in.Previous)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if tag.RowsAffected() != 1 {
		fail(w, 409, "host changed; verify again")
		return
	}
	if h.Fingerprint != "" && h.Fingerprint != fp {
		s.closeHostConnections(uid(r), h.ID)
	}
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *Server) connect(w http.ResponseWriter, r *http.Request) {
	if !s.allow("connect:"+uid(r), 20, time.Minute) {
		fail(w, 429, "too many connections")
		return
	}
	h, cred, e := s.loadHost(r, chi.URLParam(r, "id"))
	if e != nil {
		fail(w, 404, "host not found")
		return
	}
	var in struct {
		Credential *Credential `json:"credential,omitempty"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Credential != nil {
		cred = *in.Credential
	}
	if h.Fingerprint == "" {
		fail(w, 409, "verify host fingerprint first")
		return
	}
	s.mu.Lock()
	count := 0
	for _, c := range s.connections {
		if c.userID == uid(r) {
			count++
		}
	}
	s.mu.Unlock()
	if count >= 12 {
		fail(w, 409, "maximum 12 active connections")
		return
	}
	client, fp, e := s.dial(r.Context(), h, cred, false)
	if e != nil {
		if fp != "" && fp != h.Fingerprint {
			fail(w, 409, "host fingerprint changed; connection blocked")
		} else {
			fail(w, 502, e.Error())
		}
		return
	}
	sftpTimer := time.AfterFunc(12*time.Second, func() { client.Close() })
	files, e := sftp.NewClient(client)
	sftpTimer.Stop()
	if e != nil {
		client.Close()
		fail(w, 502, "SFTP subsystem unavailable")
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	id := token()
	c := &Connection{id: id, userID: uid(r), hostID: h.ID, sessionHash: digest(cookieValue(r)), client: client, files: files, ctx: ctx, cancel: cancel}
	s.mu.Lock()
	count = 0
	for _, active := range s.connections {
		if active.userID == c.userID {
			count++
		}
	}
	if count >= 12 || len(s.connections) >= 256 {
		s.mu.Unlock()
		c.Close()
		fail(w, 429, "connection capacity reached")
		return
	}
	s.connections[id] = c
	s.mu.Unlock()
	go s.guard(c)
	respond(w, 200, map[string]string{"id": id})
}
func (s *Server) guard(c *Connection) {
	defer func() { c.Close(); s.mu.Lock(); delete(s.connections, c.id); s.mu.Unlock() }()
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-t.C:
			ctx, cancel := context.WithTimeout(c.ctx, 5*time.Second)
			var ok bool
			e := s.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM sessions WHERE hash=$1 AND expires_at>now())", c.sessionHash).Scan(&ok)
			cancel()
			if e != nil || !ok {
				return
			}
			done := make(chan error, 1)
			go func() { _, _, e := c.client.SendRequest("keepalive@openssh.com", true, nil); done <- e }()
			select {
			case e := <-done:
				if e != nil {
					return
				}
			case <-time.After(5 * time.Second):
				return
			case <-c.ctx.Done():
				return
			}
		}
	}
}
func (s *Server) connection(w http.ResponseWriter, r *http.Request) *Connection {
	s.mu.Lock()
	c := s.connections[chi.URLParam(r, "id")]
	s.mu.Unlock()
	if c == nil || c.userID != uid(r) || c.sessionHash != digest(cookieValue(r)) {
		fail(w, 404, "connection not found")
		return nil
	}
	return c
}
func (s *Server) disconnect(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	c.Close()
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *Server) terminal(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	if r.Header.Get("Origin") != s.cfg.Origin {
		fail(w, 403, "invalid origin")
		return
	}
	c.mu.Lock()
	if c.terminalOpen {
		c.mu.Unlock()
		fail(w, 409, "terminal already open")
		return
	}
	c.terminalOpen = true
	c.mu.Unlock()
	defer func() { c.mu.Lock(); c.terminalOpen = false; c.mu.Unlock() }()
	setupTimer := time.AfterFunc(12*time.Second, c.Close)
	sess, e := c.client.NewSession()
	setupTimer.Stop()
	if e != nil {
		fail(w, 502, "cannot open terminal")
		return
	}
	defer sess.Close()
	shellTimer := time.AfterFunc(12*time.Second, c.Close)
	defer shellTimer.Stop()
	if e = sess.RequestPty("xterm-256color", 30, 120, ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400}); e != nil {
		fail(w, 502, "PTY unavailable")
		return
	}
	input, e := sess.StdinPipe()
	if e != nil {
		fail(w, 502, "stdin unavailable")
		return
	}
	out, e := sess.StdoutPipe()
	if e != nil {
		fail(w, 502, "stdout unavailable")
		return
	}
	errout, e := sess.StderrPipe()
	if e != nil {
		fail(w, 502, "stderr unavailable")
		return
	}
	if e = sess.Shell(); e != nil {
		fail(w, 502, "shell unavailable")
		return
	}
	shellTimer.Stop()
	ws, e := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{s.cfg.Origin}})
	if e != nil {
		return
	}
	defer ws.CloseNow()
	ws.SetReadLimit(128 << 10)
	ctx, cancel := context.WithCancel(c.ctx)
	defer cancel()
	var writeMu sync.Mutex
	pump := func(rd io.Reader) {
		b := make([]byte, 16384)
		for {
			n, e := rd.Read(b)
			if n > 0 {
				writeMu.Lock()
				wc, done := context.WithTimeout(ctx, 10*time.Second)
				err := ws.Write(wc, websocket.MessageBinary, b[:n])
				done()
				writeMu.Unlock()
				if err != nil {
					cancel()
					return
				}
			}
			if e != nil {
				return
			}
		}
	}
	go pump(out)
	go pump(errout)
	go func() { sess.Wait(); cancel() }()
	for {
		_, b, e := ws.Read(ctx)
		if e != nil {
			return
		}
		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}
		if json.Unmarshal(b, &msg) != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if _, e = input.Write([]byte(msg.Data)); e != nil {
				return
			}
		case "resize":
			if msg.Cols >= 2 && msg.Cols <= 500 && msg.Rows >= 2 && msg.Rows <= 300 {
				sess.WindowChange(msg.Rows, msg.Cols)
			}
		}
	}
}
func (c *Connection) run(ctx context.Context, command string, limit int, notify ...func(string)) (string, error) {
	setupTimer := time.AfterFunc(12*time.Second, c.Close)
	sess, e := c.client.NewSession()
	setupTimer.Stop()
	if e != nil {
		return "", e
	}
	defer sess.Close()
	b := &limitedBuffer{limit: limit}
	if len(notify) > 0 {
		b.notify = notify[0]
	}
	sess.Stdout = b
	sess.Stderr = b
	done := make(chan error, 1)
	go func() { done <- sess.Run(command) }()
	select {
	case e := <-done:
		return b.String(), e
	case <-ctx.Done():
		sess.Signal(ssh.SIGINT)
		sess.Close()
		<-done
		return b.String(), ctx.Err()
	}
}

type limitedBuffer struct {
	mu         sync.Mutex
	b          []byte
	limit      int
	notify     func(string)
	lastNotify time.Time
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n := len(p)
	if len(b.b) < b.limit {
		keep := b.limit - len(b.b)
		if keep > n {
			keep = n
		}
		b.b = append(b.b, p[:keep]...)
		if b.notify != nil && time.Since(b.lastNotify) > 100*time.Millisecond {
			b.notify(redact(string(b.b)))
			b.lastNotify = time.Now()
		}
	}
	return n, nil
}
func (b *limitedBuffer) String() string { b.mu.Lock(); defer b.mu.Unlock(); return string(b.b) }
