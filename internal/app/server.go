package app

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed schema.sql migrations/*.sql
var schema embed.FS

type Server struct {
	cfg             Config
	db              *pgxpool.Pool
	vault           *Vault
	router          *chi.Mux
	mu              sync.Mutex
	connections     map[string]*Connection
	limits          map[string]*bucket
	dummyHash       string
	authSlots       chan struct{}
	fileLocks       [64]sync.Mutex
	monitors        map[string]*monitorHub
	stopMaintenance context.CancelFunc
	lease           *pgxpool.Conn
	transferSlots   chan struct{}
	agentSlots      chan struct{}
	agentWorkers    sync.WaitGroup
	jobCancels      map[string]context.CancelFunc
	agentCache      map[string][]MonitorLatest
}
type bucket struct {
	n     int
	until time.Time
}
type userKey struct{}

func New(ctx context.Context, c Config) (*Server, error) {
	db, e := pgxpool.New(ctx, c.DatabaseURL)
	if e != nil {
		return nil, e
	}
	if e = db.Ping(ctx); e != nil {
		db.Close()
		return nil, e
	}
	lease, e := acquireLease(ctx, db)
	if e != nil {
		db.Close()
		return nil, e
	}
	success := false
	defer func() {
		if !success {
			releaseLease(lease)
			db.Close()
		}
	}()
	sql, _ := schema.ReadFile("schema.sql")
	tx, e := db.Begin(ctx)
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())"); e != nil {
		return nil, e
	}
	var checksum string
	e = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=1").Scan(&checksum)
	if isMissing(e) {
		_, e = tx.Exec(ctx, string(sql))
		if e == nil {
			_, e = tx.Exec(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)", digest(string(sql)))
		}
	} else if e == nil && checksum != digest(string(sql)) {
		return nil, errors.New("migration checksum changed; add a new migration instead of editing applied SQL")
	}
	if e != nil {
		return nil, e
	}

	for _, migration := range []struct {
		version int
		file    string
	}{
		{2, "migrations/002_agent_monitoring.sql"},
	} {
		var applied string
		e = tx.QueryRow(ctx, "SELECT checksum FROM schema_migrations WHERE version=$1", migration.version).Scan(&applied)
		raw, readErr := schema.ReadFile(migration.file)
		if readErr != nil {
			return nil, readErr
		}
		if isMissing(e) {
			if _, e = tx.Exec(ctx, string(raw)); e == nil {
				_, e = tx.Exec(ctx, "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", migration.version, digest(string(raw)))
			}
		} else if e == nil && applied != digest(string(raw)) {
			return nil, errors.New("migration checksum changed; add a new migration instead of editing SQL")
		}
		if e != nil {
			return nil, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return nil, e
	}
	v, e := NewVault(c.Key)
	if e != nil {
		return nil, e
	}
	var keyCheck string
	e = db.QueryRow(ctx, "SELECT key_check FROM vault_metadata WHERE id=1").Scan(&keyCheck)
	if isMissing(e) {
		keyCheck, e = v.Seal("remoter-vault-v1", "vault-key-check")
		if e == nil {
			_, e = db.Exec(ctx, "INSERT INTO vault_metadata(id,key_check) VALUES(1,$1)", keyCheck)
		}
	} else if e == nil {
		var p string
		p, e = v.Open(keyCheck, "vault-key-check")
		if e == nil && p != "remoter-vault-v1" {
			e = errors.New("invalid vault metadata")
		}
	}
	if e != nil {
		return nil, errors.New("MASTER_KEY does not match this database")
	}
	s := &Server{cfg: c, db: db, vault: v, connections: map[string]*Connection{}, limits: map[string]*bucket{}, dummyHash: passwordHash(token()), authSlots: make(chan struct{}, 4), monitors: map[string]*monitorHub{}, lease: lease, transferSlots: make(chan struct{}, 16)}
	s.agentSlots = make(chan struct{}, 32)
	s.jobCancels = map[string]context.CancelFunc{}
	s.agentCache = map[string][]MonitorLatest{}
	if e = s.recoverInterrupted(ctx); e != nil {
		return nil, e
	}
	maintenanceCtx, stop := context.WithCancel(context.Background())
	s.stopMaintenance = stop
	go s.maintenance(maintenanceCtx)
	s.agentWorkers.Go(func() { s.agentJobWorker(maintenanceCtx) })
	s.agentWorkers.Go(func() { s.monitorAlertMaintenance(maintenanceCtx) })
	s.agentWorkers.Go(func() { s.alertDeliveryMaintenance(maintenanceCtx) })
	s.routes()
	success = true
	return s, nil
}
func (s *Server) Close() {
	s.stopMaintenance()
	s.agentWorkers.Wait()
	s.mu.Lock()
	for id, c := range s.connections {
		c.Close()
		delete(s.connections, id)
	}
	s.mu.Unlock()
	releaseLease(s.lease)
	s.db.Close()
}
func (s *Server) Handler() http.Handler { return s.router }
func (s *Server) routes() {
	r := chi.NewRouter()
	s.router = r
	r.Use(middleware.Recoverer)
	r.Use(s.security)
	r.Post("/api/agent/register", s.agentRegister)
	r.Post("/api/agent/report", s.agentReport)
	r.Get("/api/agent/stream", s.agentStream)
	r.Get("/api/agent/releases/{name}", s.agentArtifact)
	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		ctx, c := context.WithTimeout(r.Context(), 2*time.Second)
		defer c()
		if s.db.Ping(ctx) != nil {
			fail(w, 503, "database unavailable")
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	r.Route("/api", func(r chi.Router) {
		r.Get("/bootstrap", func(w http.ResponseWriter, r *http.Request) {
			respond(w, 200, map[string]bool{"registration": s.cfg.Registration, "subscription": s.cfg.SubscriptionKey != ""})
		})
		r.Post("/register", s.register)
		r.Post("/login", s.login)
		r.Post("/billing/credit", s.credit)
		r.Post("/billing/webhook", s.billingWebhook)
		r.Group(func(r chi.Router) {
			r.Use(s.auth)
			r.Get("/me", s.me)
			r.Get("/billing/config", s.billingConfig)
			r.Post("/billing/checkout", s.billingCheckout)
			r.Post("/billing/portal", s.billingPortal)
			r.Post("/logout", s.logout)
			r.Get("/hosts", s.hostList)
			r.Post("/hosts", s.hostSave)
			r.Put("/hosts/{id}", s.hostSave)
			r.Delete("/hosts/{id}", s.hostDelete)
			r.Get("/hosts/{id}/agent", s.agentInfo)
			r.Post("/hosts/{id}/agent", s.agentEnable)
			r.Put("/hosts/{id}/agent", s.agentEnable)
			r.Post("/hosts/{id}/agent/registration", s.agentRegistration)
			r.Post("/hosts/{id}/agent/rotate", s.agentRotate)
			r.Get("/hosts/{id}/agent/jobs", s.agentJobs)
			r.Post("/hosts/{id}/agent/jobs", s.agentJobCreate)
			r.Delete("/hosts/{id}/agent", s.agentDisable)
			r.Get("/hosts/{id}/monitor", s.monitorLatest)
			r.Get("/hosts/{id}/monitor/history", s.monitorHistory)
			r.Get("/hosts/{id}/monitor/raw", s.monitorRaw)
			r.Get("/monitor/summary", s.monitorSummary)
			r.Get("/hosts/{id}/monitor/events", s.monitorEvents)
			r.Get("/hosts/{id}/alerts", s.alertsGet)
			r.Put("/hosts/{id}/alerts", s.alertsSave)
			r.Get("/hosts/{id}/alerts/deliveries", s.alertDeliveries)
			r.Post("/hosts/{id}/probe", s.probe)
			r.Post("/hosts/{id}/trust", s.trust)
			r.Post("/hosts/{id}/connect", s.connect)
			r.Delete("/connections/{id}", s.disconnect)
			r.Get("/connections/{id}/terminal", s.terminal)
			r.Get("/connections/{id}/metrics", s.metrics)
			r.Get("/connections/{id}/files", s.fileList)
			r.Post("/connections/{id}/files", s.fileOp)
			r.Get("/connections/{id}/download", s.download)
			r.Post("/connections/{id}/upload", s.upload)
			r.Get("/connections/{id}/text", s.readText)
			r.Put("/connections/{id}/text", s.writeText)
			r.Get("/ai/settings", s.aiSettingsGet)
			r.Put("/ai/settings", s.aiSettingsSave)
			r.Get("/ai/usage", s.aiUsage)
			r.Post("/ai/chat", s.aiChat)
			r.Get("/ai/tasks", s.taskList)
			r.Post("/ai/tasks", s.taskCreate)
			r.Post("/ai/tasks/{id}/execute", s.taskExecute)
			r.Post("/ai/tasks/{id}/cancel", s.taskCancel)
			r.Delete("/ai/tasks/{id}", s.taskDelete)
		})
	})
	r.Handle("/*", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fail(w, 404, "not found")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			fail(w, 405, "method not allowed")
			return
		}
		p := filepath.Join(s.cfg.WebDir, filepath.Clean("/"+r.URL.Path))
		if st, e := os.Stat(p); e == nil && !st.IsDir() {
			http.ServeFile(w, r, p)
			return
		}
		http.ServeFile(w, r, filepath.Join(s.cfg.WebDir, "index.html"))
	}))
}
func (s *Server) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
		if s.cfg.SecureCookies {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
			agentEndpoint := r.URL.Path == "/api/agent/register" || r.URL.Path == "/api/agent/report"
			if r.Method != "GET" && r.Method != "HEAD" && r.URL.Path != "/api/billing/credit" && r.URL.Path != "/api/billing/webhook" && !agentEndpoint {
				if r.Header.Get("Origin") != s.cfg.Origin {
					fail(w, 403, "invalid request origin")
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, e := r.Cookie("remoter_session")
		if e != nil {
			fail(w, 401, "login required")
			return
		}
		var u string
		e = s.db.QueryRow(r.Context(), "SELECT user_id FROM sessions WHERE hash=$1 AND expires_at>now()", digest(c.Value)).Scan(&u)
		if e != nil {
			fail(w, 401, "session expired")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, u)))
	})
}
func uid(r *http.Request) string { return r.Context().Value(userKey{}).(string) }
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, msg string) {
	respond(w, status, map[string]string{"error": msg})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool { return decodeLimit(w, r, v, 1<<20) }
func decodeLimit(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "invalid request body")
		return false
	}
	if e := d.Decode(new(any)); !errors.Is(e, io.EOF) {
		fail(w, 400, "unexpected body content")
		return false
	}
	return true
}
func (s *Server) dbError(w http.ResponseWriter, e error) {
	slog.Error("database operation failed", "error", e)
	fail(w, 500, "storage operation failed")
}
func (s *Server) allow(key string, n int, d time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if len(s.limits) > 10000 {
		for k, b := range s.limits {
			if now.After(b.until) {
				delete(s.limits, k)
			}
		}
		if len(s.limits) > 10000 {
			return false
		}
	}
	b := s.limits[key]
	if b == nil || now.After(b.until) {
		s.limits[key] = &bucket{1, now.Add(d)}
		return true
	}
	if b.n >= n {
		return false
	}
	b.n++
	return true
}
func (s *Server) remoteIP(r *http.Request) string {
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return trustedClientIP(h, r.Header.Get("X-Forwarded-For"), s.cfg.TrustedProxyCIDRs)
}
