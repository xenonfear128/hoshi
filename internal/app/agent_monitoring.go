package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"remoter/internal/agentproto"
)

type AgentInfo struct {
	Enabled      bool                    `json:"enabled"`
	Status       string                  `json:"status"`
	AgentID      string                  `json:"agentID"`
	Version      string                  `json:"version"`
	LastSeen     *time.Time              `json:"lastSeen"`
	LastCurrent  *time.Time              `json:"lastCurrent"`
	Settings     agentproto.Settings     `json:"settings"`
	Capabilities agentproto.Capabilities `json:"capabilities"`
}
type agentBinding struct {
	ID, UserID, HostID, AgentID, Version, Digest, PendingDigest, PendingSecret, Status, Config, Latest string
	Enabled                                                                                            bool
	LastSeen, LastCurrent, LastSampledAt                                                               *time.Time
}

func (s *Server) sealMonitor(owner, host, kind string, v any) (string, error) {
	b, e := json.Marshal(v)
	if e != nil {
		return "", e
	}
	return s.vault.Seal(string(b), owner+":"+host+":"+kind)
}
func (s *Server) openMonitor(owner, host, kind, raw string, v any) error {
	if raw == "" {
		return nil
	}
	b, e := s.vault.Open(raw, owner+":"+host+":"+kind)
	if e != nil {
		return e
	}
	return json.Unmarshal([]byte(b), v)
}
func bearer(r *http.Request) string {
	v := r.Header.Get("Authorization")
	if !strings.HasPrefix(v, "Bearer ") || len(v) > 256 {
		return ""
	}
	return strings.TrimSpace(v[7:])
}

const bindingColumns = `id,user_id,host_id,agent_id,version,report_digest,pending_digest,pending_secret,status,config,latest,enabled,last_seen,last_current,last_sampled_at`

func scanBinding(row pgx.Row) (agentBinding, error) {
	var b agentBinding
	e := row.Scan(&b.ID, &b.UserID, &b.HostID, &b.AgentID, &b.Version, &b.Digest, &b.PendingDigest, &b.PendingSecret, &b.Status, &b.Config, &b.Latest, &b.Enabled, &b.LastSeen, &b.LastCurrent, &b.LastSampledAt)
	return b, e
}
func (s *Server) agentSettings(b agentBinding) (agentproto.Settings, error) {
	cfg := agentproto.DefaultSettings()
	e := s.openMonitor(b.UserID, b.HostID, "agent-config", b.Config, &cfg)
	return cfg, e
}
func agentStatus(b agentBinding, cfg agentproto.Settings, now time.Time) string {
	if !b.Enabled {
		return "disabled"
	}
	if cfg.Paused {
		return "stopped"
	}
	if b.LastCurrent == nil {
		if b.Status == "failed" || b.Status == "pending" || b.Status == "installing" {
			return b.Status
		}
		return "pending"
	}
	age := now.Sub(*b.LastCurrent)
	if age > 60*time.Second {
		return "offline"
	}
	if age > time.Duration(cfg.IntervalSeconds*3)*time.Second {
		return "stale"
	}
	return "online"
}
func (s *Server) agentInfo(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	b, e := scanBinding(s.db.QueryRow(r.Context(), "SELECT "+bindingColumns+" FROM agent_bindings WHERE host_id=$1 AND user_id=$2", id, uid(r)))
	if isMissing(e) {
		respond(w, 200, AgentInfo{Status: "disabled", Settings: agentproto.DefaultSettings(), Capabilities: agentproto.Capabilities{}})
		return
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	cfg, e := s.agentSettings(b)
	if e != nil {
		s.dbError(w, e)
		return
	}
	var latest MonitorLatest
	if e = s.openMonitor(b.UserID, b.HostID, "agent-latest", b.Latest, &latest); e != nil {
		s.dbError(w, e)
		return
	}
	cap := agentproto.Capabilities{}
	if latest.Sample != nil {
		cap = latest.Sample.Capabilities
	}
	respond(w, 200, AgentInfo{Enabled: b.Enabled, Status: agentStatus(b, cfg, time.Now()), AgentID: b.AgentID, Version: b.Version, LastSeen: b.LastSeen, LastCurrent: b.LastCurrent, Settings: cfg, Capabilities: cap})
}
func (s *Server) agentEnable(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	var in struct {
		Settings agentproto.Settings `json:"settings"`
	}
	in.Settings = agentproto.DefaultSettings()
	if !decodeLimit(w, r, &in, 64<<10) {
		return
	}
	if e := in.Settings.Validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	encrypted, e := s.sealMonitor(uid(r), id, "agent-config", in.Settings)
	if e != nil {
		s.dbError(w, e)
		return
	}
	// Enabling never silently replaces a live binding or rotates its credential.
	_, e = s.db.Exec(r.Context(), `INSERT INTO agent_bindings(id,user_id,host_id,config) VALUES($1,$2,$3,$4) ON CONFLICT(host_id) DO UPDATE SET enabled=true,status=CASE WHEN agent_bindings.enabled THEN agent_bindings.status ELSE 'pending' END,config=$4,updated_at=now() WHERE agent_bindings.user_id=$2`, token(), uid(r), id, encrypted)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if in.Settings.Paused {
		s.clearAgentCache(id)
	}
	s.agentInfo(w, r)
}
func (s *Server) agentRegistration(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	b, e := scanBinding(tx.QueryRow(r.Context(), "SELECT "+bindingColumns+" FROM agent_bindings WHERE host_id=$1 AND user_id=$2 AND enabled=true FOR UPDATE", id, uid(r)))
	if e != nil {
		fail(w, 404, "enabled agent not found")
		return
	}
	if b.Digest != "" {
		fail(w, 409, "revoke the existing credential before rebinding")
		return
	}
	secret := token()
	_, e = tx.Exec(r.Context(), "DELETE FROM agent_registration_tokens WHERE binding_id=$1", b.ID)
	if e == nil {
		_, e = tx.Exec(r.Context(), "INSERT INTO agent_registration_tokens(digest,binding_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", digest(secret), b.ID)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, map[string]any{"registrationToken": secret, "expiresAt": time.Now().Add(10 * time.Minute), "serverURL": s.cfg.Origin})
}
func (s *Server) agentDisable(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var binding string
	e = tx.QueryRow(r.Context(), `UPDATE agent_bindings SET enabled=false,status='disabled',report_digest='',pending_digest='',pending_secret='',last_current=NULL,updated_at=now() WHERE host_id=$1 AND user_id=$2 RETURNING id`, id, uid(r)).Scan(&binding)
	if isMissing(e) {
		fail(w, 404, "agent not found")
		return
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM agent_registration_tokens WHERE binding_id=$1", binding)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.clearAgentCache(id)
	s.mu.Lock()
	if cancel := s.jobCancels[id]; cancel != nil {
		cancel()
	}
	s.mu.Unlock()
	respond(w, 200, map[string]bool{"ok": true})
}
func (s *Server) agentRotate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	secret := token()
	sealed, e := s.sealMonitor(uid(r), id, "agent-pending-token", secret)
	if e != nil {
		s.dbError(w, e)
		return
	}
	tag, e := s.db.Exec(r.Context(), `UPDATE agent_bindings SET pending_digest=$3,pending_secret=$4,updated_at=now() WHERE host_id=$1 AND user_id=$2 AND enabled=true AND report_digest<>'' AND pending_digest=''`, id, uid(r), digest(secret), sealed)
	if e != nil {
		s.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "credential rotation unavailable or already pending")
		return
	}
	respond(w, 200, map[string]string{"status": "pending"})
}
func (s *Server) agentRegister(w http.ResponseWriter, r *http.Request) {
	if !s.allow("agent-register:"+s.remoteIP(r), 20, time.Minute) {
		fail(w, 429, "rate limit exceeded")
		return
	}
	var in agentproto.RegisterRequest
	if !decodeLimit(w, r, &in, 16<<10) {
		return
	}
	if in.Protocol != agentproto.ProtocolVersion || !agentproto.ValidID(in.AgentID) || len(in.Version) > 64 {
		fail(w, 400, "invalid registration")
		return
	}
	raw := bearer(r)
	if raw == "" {
		fail(w, 401, "agent credential required")
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var binding string
	// UPDATE RETURNING consumes the token atomically; concurrent exchanges fail.
	e = tx.QueryRow(r.Context(), `UPDATE agent_registration_tokens SET used_at=now() WHERE digest=$1 AND used_at IS NULL AND expires_at>now() RETURNING binding_id`, digest(raw)).Scan(&binding)
	if e != nil {
		fail(w, 401, "registration token invalid or expired")
		return
	}
	b, e := scanBinding(tx.QueryRow(r.Context(), "SELECT "+bindingColumns+" FROM agent_bindings WHERE id=$1 AND enabled=true AND report_digest='' FOR UPDATE", binding))
	if e != nil {
		fail(w, 401, "agent binding unavailable")
		return
	}
	cfg, e := s.agentSettings(b)
	if e != nil {
		s.dbError(w, e)
		return
	}
	secret := token()
	_, e = tx.Exec(r.Context(), `UPDATE agent_bindings SET agent_id=$2,version=$3,report_digest=$4,status='installing',last_current=NULL,updated_at=now() WHERE id=$1`, binding, in.AgentID, in.Version, digest(secret))
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, agentproto.RegisterResponse{ReportToken: secret, Settings: cfg})
}

var errAgentAuth = errors.New("agent credential invalid")

func (s *Server) agentIdentity(ctx context.Context, secret string) (string, error) {
	if secret == "" {
		return "", errAgentAuth
	}
	var id string
	e := s.db.QueryRow(ctx, `SELECT id FROM agent_bindings WHERE enabled=true AND (report_digest=$1 OR pending_digest=$1)`, digest(secret)).Scan(&id)
	if e != nil {
		return "", errAgentAuth
	}
	return id, nil
}
func (s *Server) agentReport(w http.ResponseWriter, r *http.Request) {
	if !s.allow("agent-report-ip:"+s.remoteIP(r), 6000, time.Minute) {
		fail(w, 429, "rate limit exceeded")
		return
	}
	secret := bearer(r)
	id, e := s.agentIdentity(r.Context(), secret)
	if e != nil {
		fail(w, 401, errAgentAuth.Error())
		return
	}
	if !s.allow("agent-report:"+id, 900, time.Minute) {
		fail(w, 429, "rate limit exceeded")
		return
	}
	var in agentproto.ReportRequest
	if !decodeLimit(w, r, &in, agentproto.MaxBody) {
		return
	}
	if in.Sample != nil {
		if e = in.Sample.Validate(time.Now()); e != nil {
			fail(w, 400, e.Error())
			return
		}
	}
	out, e := s.ingestAgent(r.Context(), id, secret, in)
	if errors.Is(e, errAgentAuth) {
		fail(w, 401, e.Error())
		return
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, out)
}
func (s *Server) agentStream(w http.ResponseWriter, r *http.Request) {
	secret := bearer(r)
	id, e := s.agentIdentity(r.Context(), secret)
	if e != nil {
		fail(w, 401, errAgentAuth.Error())
		return
	}
	if !s.allow("agent-stream:"+id, 20, time.Minute) {
		fail(w, 429, "rate limit exceeded")
		return
	}
	// Browser origins cannot use this endpoint. Agent authentication is independent.
	if r.Header.Get("Origin") != "" {
		fail(w, 403, "agent endpoint does not accept browser origins")
		return
	}
	ws, e := websocket.Accept(w, r, nil)
	if e != nil {
		return
	}
	defer ws.CloseNow()
	ws.SetReadLimit(agentproto.MaxBody)
	for {
		ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
		_, raw, e := ws.Read(ctx)
		cancel()
		if e != nil {
			return
		}
		if !s.allow("agent-report:"+id, 900, time.Minute) {
			ws.Close(websocket.StatusPolicyViolation, "rate limit")
			return
		}
		var in agentproto.ReportRequest
		d := json.NewDecoder(strings.NewReader(string(raw)))
		d.DisallowUnknownFields()
		if d.Decode(&in) != nil {
			ws.Close(websocket.StatusInvalidFramePayloadData, "invalid report")
			return
		}
		if in.Sample != nil && in.Sample.Validate(time.Now()) != nil {
			ws.Close(websocket.StatusPolicyViolation, "invalid sample")
			return
		}
		out, e := s.ingestAgent(r.Context(), id, secret, in)
		if e != nil {
			ws.Close(websocket.StatusPolicyViolation, "report rejected")
			return
		}
		encoded, _ := json.Marshal(out)
		ctx, cancel = context.WithTimeout(r.Context(), 10*time.Second)
		e = ws.Write(ctx, websocket.MessageText, encoded)
		cancel()
		if e != nil {
			return
		}
	}
}
func (s *Server) ingestAgent(ctx context.Context, id, secret string, in agentproto.ReportRequest) (agentproto.ReportResponse, error) {
	out := agentproto.ReportResponse{}
	select {
	case s.agentSlots <- struct{}{}:
		defer func() { <-s.agentSlots }()
	case <-ctx.Done():
		return out, ctx.Err()
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	tx, e := s.db.Begin(ctx)
	if e != nil {
		return out, e
	}
	defer tx.Rollback(ctx)
	b, e := scanBinding(tx.QueryRow(ctx, "SELECT "+bindingColumns+" FROM agent_bindings WHERE id=$1 FOR UPDATE", id))
	hash := digest(secret)
	if e != nil || !b.Enabled || (hash != b.Digest && hash != b.PendingDigest) {
		return out, errAgentAuth
	}
	out.Settings, e = s.agentSettings(b)
	if e != nil {
		return out, e
	}
	if b.PendingDigest != "" {
		if hash == b.PendingDigest {
			_, e = tx.Exec(ctx, "UPDATE agent_bindings SET report_digest=pending_digest,pending_digest='',pending_secret='' WHERE id=$1", id)
		} else {
			e = s.openMonitor(b.UserID, b.HostID, "agent-pending-token", b.PendingSecret, &out.ReportToken)
		}
		if e != nil {
			return out, e
		}
	}
	now := time.Now().UTC()
	_, e = tx.Exec(ctx, "UPDATE agent_bindings SET last_seen=$2 WHERE id=$1", id, now)
	if e != nil {
		return out, e
	}
	sample := in.Sample
	if sample == nil || out.Settings.Paused {
		e = tx.Commit(ctx)
		return out, e
	}
	if sample.AgentID != b.AgentID {
		return out, errAgentAuth
	}
	tag, e := tx.Exec(ctx, `INSERT INTO metric_samples(binding_id,session_id,sequence,sample_second) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, b.ID, sample.SessionID, sample.Sequence, sample.SampledAt.Unix())
	if e != nil {
		return out, e
	}
	if tag.RowsAffected() == 0 {
		out.Accepted = true
		e = tx.Commit(ctx)
		return out, e
	}
	var previous MonitorLatest
	if e = s.openMonitor(b.UserID, b.HostID, "agent-latest", b.Latest, &previous); e != nil {
		return out, e
	}
	latest := deriveMetrics(*sample, previous, out.Settings)
	latest.ReceivedAt = now
	if e = s.persistMonitor(ctx, tx, b, latest, previous, out.Settings); e != nil {
		return out, e
	}
	ordered := previous.Sample == nil || sample.SampledAt.After(previous.Sample.SampledAt)
	fresh := now.Sub(sample.SampledAt) <= time.Duration(max(10, out.Settings.IntervalSeconds*3))*time.Second
	if ordered {
		encrypted, e := s.sealMonitor(b.UserID, b.HostID, "agent-latest", latest)
		if e != nil {
			return out, e
		}
		_, e = tx.Exec(ctx, `UPDATE agent_bindings SET latest=$2,version=$3,last_sampled_at=$4,last_current=CASE WHEN $5 THEN $6 ELSE last_current END,status=CASE WHEN $5 THEN 'online' ELSE status END WHERE id=$1`, b.ID, encrypted, sample.Version, sample.SampledAt, fresh, now)
		if e != nil {
			return out, e
		}
		if fresh {

			_, e = tx.Exec(ctx, `UPDATE agent_install_jobs SET status='complete',message='first authenticated report received',credential='',updated_at=now() WHERE host_id=$1 AND kind IN ('install','upgrade') AND status='waiting' AND expected_version=$2 AND previous_session<>$3 AND report_after<$4`, b.HostID, sample.Version, sample.SessionID, sample.SampledAt)
			if e != nil {
				return out, e
			}
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return out, e
	}
	if ordered {
		s.cacheAgent(b.HostID, latest)
	}
	out.Accepted = true
	return out, nil
}
func (s *Server) monitorEvents(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	rows, e := s.db.Query(r.Context(), "SELECT id,kind,severity,data,created_at FROM monitor_events WHERE host_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 200", id, uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var event, kind, severity, data string
		var t time.Time
		if e = rows.Scan(&event, &kind, &severity, &data, &t); e != nil {
			break
		}
		var details any
		if e = s.openMonitor(uid(r), id, "event:"+event, data, &details); e != nil {
			break
		}
		out = append(out, map[string]any{"id": event, "kind": kind, "severity": severity, "data": details, "createdAt": t})
	}
	if e == nil {
		e = rows.Err()
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, out)
}
func (s *Server) monitorEvent(ctx context.Context, tx pgx.Tx, b agentBinding, kind, severity string, details any) (string, error) {
	id := token()
	data, e := s.sealMonitor(b.UserID, b.HostID, "event:"+id, details)
	if e != nil {
		return "", e
	}
	_, e = tx.Exec(ctx, "INSERT INTO monitor_events(id,user_id,host_id,kind,severity,data) VALUES($1,$2,$3,$4,$5,$6)", id, b.UserID, b.HostID, kind, severity, data)
	return id, e
}
func jsonBytes(v any) []byte { b, _ := json.Marshal(v); return b }
func monitorAAD(step int, bucket time.Time) string {
	return fmt.Sprintf("rollup:%d:%d", step, bucket.Unix())
}
