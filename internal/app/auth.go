package app

import (
	"github.com/jackc/pgx/v5/pgconn"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

type loginInput struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	select {
	case s.authSlots <- struct{}{}:
		defer func() { <-s.authSlots }()
	default:
		fail(w, 429, "authentication busy; retry shortly")
		return
	}
	if !s.cfg.Registration {
		fail(w, 403, "registration is disabled")
		return
	}
	if !s.allow("register:"+s.remoteIP(r), 5, time.Hour) {
		fail(w, 429, "try again later")
		return
	}
	var v loginInput
	if !decode(w, r, &v) {
		return
	}
	v.Email = strings.ToLower(strings.TrimSpace(v.Email))
	a, e := mail.ParseAddress(v.Email)
	if e != nil || a.Address != v.Email || len(v.Email) > 254 || len(v.Password) < 12 || len(v.Password) > 256 {
		fail(w, 400, "valid email and password of 12–256 characters required")
		return
	}
	id := token()
	_, e = s.db.Exec(r.Context(), "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", id, v.Email, passwordHash(v.Password))
	if e != nil {
		if pe, ok := e.(*pgconn.PgError); ok && pe.Code == "23505" {
			fail(w, 409, "email already registered")
			return
		}
		s.dbError(w, e)
		return
	}
	s.issueSession(w, r, id)
}
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	select {
	case s.authSlots <- struct{}{}:
		defer func() { <-s.authSlots }()
	default:
		fail(w, 429, "authentication busy; retry shortly")
		return
	}
	if !s.allow("login:"+s.remoteIP(r), 20, 15*time.Minute) {
		fail(w, 429, "too many attempts")
		return
	}
	var v loginInput
	if !decode(w, r, &v) {
		return
	}
	if len(v.Password) > 256 {
		fail(w, 400, "invalid credentials")
		return
	}
	var id, h string
	e := s.db.QueryRow(r.Context(), "SELECT id,password_hash FROM users WHERE email=$1", strings.ToLower(strings.TrimSpace(v.Email))).Scan(&id, &h)
	if e != nil {
		h = s.dummyHash
	}
	valid := passwordMatch(v.Password, h)
	if e != nil || !valid {
		fail(w, 401, "invalid email or password")
		return
	}
	s.issueSession(w, r, id)
}
func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, id string) {
	t := token()
	_, e := s.db.Exec(r.Context(), "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,$3)", digest(t), id, time.Now().Add(s.cfg.SessionTTL))
	if e != nil {
		s.dbError(w, e)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "remoter_session", Value: t, Path: "/", HttpOnly: true, Secure: s.cfg.SecureCookies, SameSite: http.SameSiteStrictMode, MaxAge: int(s.cfg.SessionTTL.Seconds())})
	respond(w, 200, map[string]string{"id": id})
}
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	var email string
	if e := s.db.QueryRow(r.Context(), "SELECT email FROM users WHERE id=$1", uid(r)).Scan(&email); e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, map[string]string{"id": uid(r), "email": email})
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("remoter_session")
	_, e := s.db.Exec(r.Context(), "DELETE FROM sessions WHERE hash=$1", digest(c.Value))
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.mu.Lock()
	for id, c := range s.connections {
		if c.sessionHash == digest(cookieValue(r)) {
			c.Close()
			delete(s.connections, id)
		}
	}
	s.mu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "remoter_session", Path: "/", Value: "", MaxAge: -1, HttpOnly: true, Secure: s.cfg.SecureCookies, SameSite: http.SameSiteStrictMode})
	respond(w, 200, map[string]bool{"ok": true})
}
func cookieValue(r *http.Request) string {
	c, e := r.Cookie("remoter_session")
	if e != nil {
		return ""
	}
	return c.Value
}
