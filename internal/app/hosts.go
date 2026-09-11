package app

import (
	"encoding/json"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

type Host struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Address       string `json:"address"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	Group         string `json:"group"`
	Note          string `json:"note"`
	AuthType      string `json:"authType"`
	HasCredential bool   `json:"hasCredential"`
	Fingerprint   string `json:"fingerprint"`
	AgentEnabled  bool   `json:"agentEnabled"`
	AgentStatus   string `json:"agentStatus,omitempty"`
}
type Credential struct {
	Password   string `json:"password"`
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
}
type hostInput struct {
	Host
	Credential      *Credential `json:"credential,omitempty"`
	ClearCredential bool        `json:"clearCredential"`
}

func (s *Server) loadHost(r *http.Request, id string) (Host, Credential, error) {
	var h Host
	var c Credential
	var data, secret, fp string
	e := s.db.QueryRow(r.Context(), "SELECT data,credential,fingerprint FROM hosts WHERE id=$1 AND user_id=$2", id, uid(r)).Scan(&data, &secret, &fp)
	if e != nil {
		return h, c, e
	}
	p, e := s.vault.Open(data, uid(r)+":"+id+":host")
	if e != nil {
		return h, c, e
	}
	if e = json.Unmarshal([]byte(p), &h); e != nil {
		return h, c, e
	}
	h.ID = id
	h.HasCredential = secret != ""
	h.Fingerprint = fp
	var enabled bool
	var status string
	if e2 := s.db.QueryRow(r.Context(), "SELECT enabled,status FROM agent_bindings WHERE host_id=$1 AND user_id=$2", id, uid(r)).Scan(&enabled, &status); e2 == nil {
		h.AgentEnabled = enabled
		h.AgentStatus = status
	}
	if secret != "" {
		p, e = s.vault.Open(secret, uid(r)+":"+id+":credential")
		if e != nil {
			return h, c, e
		}
		e = json.Unmarshal([]byte(p), &c)
	}
	return h, c, e
}
func (s *Server) hostList(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT id,data,credential<>'',fingerprint FROM hosts WHERE user_id=$1 ORDER BY created_at", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	hosts := []Host{}
	for rows.Next() {
		var id, d, fp string
		var has bool
		if e = rows.Scan(&id, &d, &has, &fp); e != nil {
			break
		}
		var p string
		p, e = s.vault.Open(d, uid(r)+":"+id+":host")
		if e != nil {
			break
		}
		var h Host
		e = json.Unmarshal([]byte(p), &h)
		if e != nil {
			break
		}
		h.ID = id
		h.HasCredential = has
		h.Fingerprint = fp
		var enabled bool
		var status string
		if e2 := s.db.QueryRow(r.Context(), "SELECT enabled,status FROM agent_bindings WHERE host_id=$1 AND user_id=$2", id, uid(r)).Scan(&enabled, &status); e2 == nil {
			h.AgentEnabled = enabled
			h.AgentStatus = status
		}
		hosts = append(hosts, h)
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	if rows.Err() != nil {
		s.dbError(w, rows.Err())
		return
	}
	respond(w, 200, hosts)
}
func (s *Server) hostSave(w http.ResponseWriter, r *http.Request) {
	var in hostInput
	if !decode(w, r, &in) {
		return
	}
	h := in.Host
	h.Name = strings.TrimSpace(h.Name)
	h.Address = strings.TrimSpace(h.Address)
	if h.Name == "" || len(h.Name) > 128 || h.Address == "" || strings.ContainsAny(h.Address, " /\t\n\r") || len(h.Address) > 253 || h.Port < 1 || h.Port > 65535 || h.Username == "" || len(h.Username) > 128 || len(h.Note) > 4096 || len(h.Group) > 128 || (h.AuthType != "password" && h.AuthType != "key") {
		fail(w, 400, "invalid host configuration")
		return
	}
	id := chi.URLParam(r, "id")
	fp := ""
	secret := ""
	if id != "" {
		old, _, e := s.loadHost(r, id)
		if e != nil {
			fail(w, 404, "host not found")
			return
		}
		fp = old.Fingerprint
		if old.Address != h.Address || old.Port != h.Port {
			if old.AgentEnabled {
				fail(w, 409, "revoke monitoring before changing the host address or port")
				return
			}
			fp = ""
		}
		e = s.db.QueryRow(r.Context(), "SELECT credential FROM hosts WHERE id=$1 AND user_id=$2", id, uid(r)).Scan(&secret)
		if e != nil {
			s.dbError(w, e)
			return
		}
		if old.AuthType != h.AuthType {
			secret = ""
		}
	} else {
		id = token()
	}
	h.ID = id
	h.Fingerprint = ""
	h.HasCredential = false
	if in.ClearCredential {
		secret = ""
	}
	if in.Credential != nil {
		b, _ := json.Marshal(in.Credential)
		var e error
		secret, e = s.vault.Seal(string(b), uid(r)+":"+id+":credential")
		if e != nil {
			s.dbError(w, e)
			return
		}
	}
	b, _ := json.Marshal(h)
	data, e := s.vault.Seal(string(b), uid(r)+":"+id+":host")
	if e != nil {
		s.dbError(w, e)
		return
	}
	_, e = s.db.Exec(r.Context(), "INSERT INTO hosts(id,user_id,data,credential,fingerprint) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET data=$3,credential=$4,fingerprint=$5,updated_at=now() WHERE hosts.user_id=$2", id, uid(r), data, secret, fp)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if chi.URLParam(r, "id") != "" {
		s.closeHostConnections(uid(r), id)
	}
	h.HasCredential = secret != ""
	h.Fingerprint = fp
	respond(w, 200, h)
}
func (s *Server) hostDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	s.mu.Lock()
	if cancel := s.jobCancels[id]; cancel != nil {
		cancel()
	}
	delete(s.agentCache, id)
	s.mu.Unlock()
	tag, e := s.db.Exec(r.Context(), "DELETE FROM hosts WHERE id=$1 AND user_id=$2", id, uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "host not found")
		return
	}
	s.mu.Lock()
	for cid, c := range s.connections {
		if c.hostID == id && c.userID == uid(r) {
			c.Close()
			delete(s.connections, cid)
		}
	}
	s.mu.Unlock()
	respond(w, 200, map[string]bool{"ok": true})
}
func isMissing(e error) bool { return errors.Is(e, pgx.ErrNoRows) }

func (s *Server) closeHostConnections(user, hostID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, c := range s.connections {
		if c.userID == user && c.hostID == hostID {
			c.Close()
			delete(s.connections, id)
		}
	}
}
