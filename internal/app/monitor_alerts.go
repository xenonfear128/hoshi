package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type AlertConfig struct {
	Enabled             bool       `json:"enabled"`
	OfflineGraceSeconds int        `json:"offlineGraceSeconds"`
	DurationSeconds     int        `json:"durationSeconds"`
	RecoverySeconds     int        `json:"recoverySeconds"`
	CooldownSeconds     int        `json:"cooldownSeconds"`
	HysteresisPercent   float64    `json:"hysteresisPercent"`
	CPUPercent          float64    `json:"cpuPercent"`
	MemoryPercent       float64    `json:"memoryPercent"`
	DiskPercent         float64    `json:"diskPercent"`
	MuteUntil           *time.Time `json:"muteUntil"`
	WebhookURL          string     `json:"webhookURL,omitempty"`
	HasWebhook          bool       `json:"hasWebhook"`
}

func defaultAlertConfig() AlertConfig {
	return AlertConfig{Enabled: true, OfflineGraceSeconds: 180, DurationSeconds: 60, RecoverySeconds: 30, CooldownSeconds: 300, HysteresisPercent: 5}
}
func (c AlertConfig) validate() error {
	if c.OfflineGraceSeconds < 60 || c.OfflineGraceSeconds > 86400 || c.DurationSeconds < 5 || c.DurationSeconds > 3600 || c.RecoverySeconds < 5 || c.RecoverySeconds > 3600 || c.CooldownSeconds < 0 || c.CooldownSeconds > 86400 {
		return errors.New("invalid alert timing")
	}
	for _, v := range []float64{c.CPUPercent, c.MemoryPercent, c.DiskPercent} {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 100 {
			return errors.New("threshold must be 1-100 or zero")
		}
	}
	if c.HysteresisPercent < 0 || c.HysteresisPercent > 50 || math.IsNaN(c.HysteresisPercent) {
		return errors.New("invalid recovery hysteresis")
	}
	if c.MuteUntil != nil && c.MuteUntil.After(time.Now().Add(366*24*time.Hour)) {
		return errors.New("maintenance mute is limited to one year")
	}
	if c.WebhookURL != "" {
		return validateWebhook(c.WebhookURL)
	}
	return nil
}
func validateWebhook(endpoint string) error {
	u, e := url.Parse(endpoint)
	if e != nil || len(endpoint) > 2048 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Fragment != "" {
		return errors.New("webhook must be a valid HTTPS URL")
	}
	return nil
}
func (s *Server) alertsGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	cfg := defaultAlertConfig()
	var raw string
	e := s.db.QueryRow(r.Context(), "SELECT config FROM alert_rules WHERE host_id=$1 AND user_id=$2", id, uid(r)).Scan(&raw)
	if e == nil {
		e = s.openMonitor(uid(r), id, "alert-config", raw, &cfg)
	}
	if e != nil && !isMissing(e) {
		s.dbError(w, e)
		return
	}
	cfg.HasWebhook = cfg.WebhookURL != ""
	cfg.WebhookURL = ""
	respond(w, 200, cfg)
}
func (s *Server) alertsSave(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	var in struct {
		AlertConfig
		ClearWebhook bool `json:"clearWebhook"`
	}
	in.AlertConfig = defaultAlertConfig()
	if !decodeLimit(w, r, &in, 32<<10) {
		return
	}
	if e := in.validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var raw string
	old := defaultAlertConfig()
	e = tx.QueryRow(r.Context(), "SELECT config FROM alert_rules WHERE host_id=$1 AND user_id=$2 FOR UPDATE", id, uid(r)).Scan(&raw)
	if e == nil {
		e = s.openMonitor(uid(r), id, "alert-config", raw, &old)
	}
	if e != nil && !isMissing(e) {
		s.dbError(w, e)
		return
	}
	if in.ClearWebhook {
		in.WebhookURL = ""
	} else if in.WebhookURL == "" {
		in.WebhookURL = old.WebhookURL
	}
	encrypted, e := s.sealMonitor(uid(r), id, "alert-config", in.AlertConfig)
	if e == nil {
		_, e = tx.Exec(r.Context(), `INSERT INTO alert_rules(host_id,user_id,config) VALUES($1,$2,$3) ON CONFLICT(host_id) DO UPDATE SET config=$3,state='',updated_at=now() WHERE alert_rules.user_id=$2`, id, uid(r), encrypted)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	s.alertsGet(w, r)
}

type alertState struct {
	Active        bool       `json:"active"`
	Since         *time.Time `json:"since"`
	RecoverySince *time.Time `json:"recoverySince"`
	LastObserved  *time.Time `json:"lastObserved"`
	LastNotified  *time.Time `json:"lastNotified"`
}

// transitionAlert requires uninterrupted observations and separate recovery dwell.
// Missing metrics suspend active alerts; they never mean a recovered zero.
func transitionAlert(st alertState, now time.Time, known, trigger, recover bool, hold, recovery, cooldown time.Duration) (alertState, string) {
	if !known {
		st.Since = nil
		st.RecoverySince = nil
		st.LastObserved = nil
		return st, ""
	}
	if st.LastObserved != nil && now.Sub(*st.LastObserved) > 15*time.Second {
		st.Since = nil
		st.RecoverySince = nil
	}
	st.LastObserved = &now
	if !st.Active {
		st.RecoverySince = nil
		if !trigger {
			st.Since = nil
			return st, ""
		}
		if st.Since == nil {
			st.Since = &now
		}
		if now.Sub(*st.Since) >= hold && (st.LastNotified == nil || now.Sub(*st.LastNotified) >= cooldown) {
			st.Active = true
			st.LastNotified = &now
			return st, "trigger"
		}
	} else {
		st.Since = nil
		if !recover {
			st.RecoverySince = nil
			return st, ""
		}
		if st.RecoverySince == nil {
			st.RecoverySince = &now
		}
		if now.Sub(*st.RecoverySince) >= recovery {
			st.Active = false
			st.RecoverySince = nil
			st.LastNotified = &now
			return st, "recovery"
		}
	}
	return st, ""
}
func (s *Server) monitorAlertMaintenance(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if e := s.evaluateAlerts(ctx); e != nil && ctx.Err() == nil {
			slog.Error("monitor alerts failed", "error", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) evaluateAlerts(ctx context.Context) error {
	rows, e := s.db.Query(ctx, "SELECT host_id FROM agent_bindings WHERE enabled=true")
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, id := range ids {
		if e = s.evaluateHostAlerts(ctx, id, time.Now().UTC()); e != nil {
			return e
		}
	}
	return nil
}
func (s *Server) evaluateHostAlerts(ctx context.Context, host string, now time.Time) error {
	tx, e := s.db.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	b, e := scanBinding(tx.QueryRow(ctx, "SELECT "+bindingColumns+" FROM agent_bindings WHERE host_id=$1 FOR UPDATE", host))
	if isMissing(e) {
		return nil
	}
	if e != nil {
		return e
	}
	agentCfg, e := s.agentSettings(b)
	if e != nil {
		return e
	}
	cfg := defaultAlertConfig()
	var raw, stateRaw string
	e = tx.QueryRow(ctx, "SELECT config,state FROM alert_rules WHERE host_id=$1 FOR UPDATE", host).Scan(&raw, &stateRaw)
	if isMissing(e) {
		raw, e = s.sealMonitor(b.UserID, host, "alert-config", cfg)
		if e == nil {
			_, e = tx.Exec(ctx, "INSERT INTO alert_rules(host_id,user_id,config) VALUES($1,$2,$3)", host, b.UserID, raw)
		}
	} else if e == nil {
		e = s.openMonitor(b.UserID, host, "alert-config", raw, &cfg)
	}
	if e != nil {
		return e
	}
	state := map[string]alertState{}
	if e = s.openMonitor(b.UserID, host, "alert-state", stateRaw, &state); e != nil {
		return e
	}
	muted := !b.Enabled || !cfg.Enabled || agentCfg.Paused || (cfg.MuteUntil != nil && now.Before(*cfg.MuteUntil))
	var latest MonitorLatest
	if e = s.openMonitor(b.UserID, host, "agent-latest", b.Latest, &latest); e != nil {
		return e
	}
	fresh := !muted && agentStatus(b, agentCfg, now) == "online"
	process := func(key string, value float64, known, trigger, recover bool, hold time.Duration) error {
		st, change := transitionAlert(state[key], now, known && !muted, trigger, recover, hold, time.Duration(cfg.RecoverySeconds)*time.Second, time.Duration(cfg.CooldownSeconds)*time.Second)
		state[key] = st
		if change == "" {
			return nil
		}
		severity := "warning"
		kind := key
		if change == "recovery" {
			severity = "info"
			kind = key + "_recovered"
		}
		event, e := s.monitorEvent(ctx, tx, b, kind, severity, map[string]any{"value": value, "observedAt": now})
		if e == nil && cfg.WebhookURL != "" {
			_, e = tx.Exec(ctx, "INSERT INTO alert_deliveries(id,event_id,host_id,user_id) VALUES($1,$2,$3,$4)", token(), event, host, b.UserID)
		}
		return e
	}
	age := 0.0
	offlineKnown := b.LastCurrent != nil
	if offlineKnown {
		age = now.Sub(*b.LastCurrent).Seconds()
	}
	if e = process("agent_offline", age, offlineKnown, age >= float64(cfg.OfflineGraceSeconds), fresh, 0); e != nil {
		return e
	}
	active := map[string]bool{"agent_offline": true}
	threshold := func(key, metric string, limit float64) error {
		active[key] = true
		value, ok := latest.Values[metric]
		return process(key, value, fresh && ok && limit > 0, value >= limit, value <= math.Max(0, limit-cfg.HysteresisPercent), time.Duration(cfg.DurationSeconds)*time.Second)
	}
	if e = threshold("cpu_high", "cpu", cfg.CPUPercent); e != nil {
		return e
	}
	if e = threshold("memory_high", "memory", cfg.MemoryPercent); e != nil {
		return e
	}
	for metric := range latest.Values {
		if strings.HasPrefix(metric, "mount:") && strings.HasSuffix(metric, ":percent") {
			if e = threshold("disk_high:"+strings.TrimSuffix(strings.TrimPrefix(metric, "mount:"), ":percent"), metric, cfg.DiskPercent); e != nil {
				return e
			}
		}
	}
	if agentCfg.QuotaBytes > 0 {
		start, _ := billingPeriod(now, "month", agentCfg)
		var trafficRaw string
		totals := map[string]Traffic{}
		e = tx.QueryRow(ctx, "SELECT data FROM monitor_traffic WHERE host_id=$1 AND period='month' AND start_at=$2", host, start).Scan(&trafficRaw)
		if e == nil {
			e = s.openMonitor(b.UserID, host, trafficAAD("month", start), trafficRaw, &totals)
		}
		if e != nil && !isMissing(e) {
			return e
		}
		var total uint64
		if latest.Sample != nil {
			for _, n := range latest.Sample.Network {
				if selectedInterface(n, agentCfg) {
					t := totals[n.Name]
					total += t.Rx + t.Tx
				}
			}
		}
		active["traffic_quota"] = true
		if e = process("traffic_quota", float64(total), fresh, total >= agentCfg.QuotaBytes, total < agentCfg.QuotaBytes, 0); e != nil {
			return e
		}
	}
	for key := range state {
		if !active[key] {
			delete(state, key)
		}
	}
	encrypted, e := s.sealMonitor(b.UserID, host, "alert-state", state)
	if e == nil {
		_, e = tx.Exec(ctx, "UPDATE alert_rules SET state=$2 WHERE host_id=$1", host, encrypted)
	}
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
func (s *Server) alertDeliveryMaintenance(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if e := s.deliverPendingAlerts(ctx); e != nil && ctx.Err() == nil {
			slog.Error("monitor webhook worker failed", "error", e)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

type pendingDelivery struct {
	ID, Event, Host, User, Data, Config, Kind string
	Attempts                                  int
	Created                                   time.Time
}

func (s *Server) deliverPendingAlerts(ctx context.Context) error {
	rows, e := s.db.Query(ctx, `SELECT d.id,d.event_id,d.host_id,d.user_id,d.attempts,e.data,a.config,e.kind,e.created_at FROM alert_deliveries d JOIN monitor_events e ON e.id=d.event_id JOIN alert_rules a ON a.host_id=d.host_id AND a.user_id=d.user_id WHERE d.status='pending' AND d.next_attempt<=now() ORDER BY d.created_at LIMIT 8`)
	if e != nil {
		return e
	}
	pending := []pendingDelivery{}
	for rows.Next() {
		var d pendingDelivery
		if e = rows.Scan(&d.ID, &d.Event, &d.Host, &d.User, &d.Attempts, &d.Data, &d.Config, &d.Kind, &d.Created); e != nil {
			break
		}
		pending = append(pending, d)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		return e
	}
	for _, d := range pending {
		cfg := defaultAlertConfig()
		if e = s.openMonitor(d.User, d.Host, "alert-config", d.Config, &cfg); e != nil {
			return e
		}
		if !cfg.Enabled || cfg.WebhookURL == "" || (cfg.MuteUntil != nil && time.Now().Before(*cfg.MuteUntil)) {
			_, e = s.db.Exec(ctx, "UPDATE alert_deliveries SET status='discarded',last_error='webhook disabled or muted' WHERE id=$1", d.ID)
			if e != nil {
				return e
			}
			continue
		}
		var detail any
		if e = s.openMonitor(d.User, d.Host, "event:"+d.Event, d.Data, &detail); e != nil {
			return e
		}
		payload, _ := json.Marshal(map[string]any{"eventID": d.Event, "hostID": d.Host, "kind": d.Kind, "data": detail, "createdAt": d.Created})
		err := s.sendMonitorWebhook(ctx, cfg.WebhookURL, payload, d.Event)
		status := "delivered"
		message := ""
		next := time.Now()
		if err != nil {
			message = "HTTPS delivery failed"
			status = "pending"
			if d.Attempts >= 7 {
				status = "failed"
			}
			next = next.Add(time.Duration(1<<min(d.Attempts, 7)) * time.Minute)
		}
		_, e = s.db.Exec(ctx, "UPDATE alert_deliveries SET status=$2,attempts=attempts+1,last_error=$3,next_attempt=$4 WHERE id=$1", d.ID, status, message, next)
		if e != nil {
			return e
		}
	}
	return nil
}
func (s *Server) sendMonitorWebhook(ctx context.Context, endpoint string, payload []byte, event string) error {
	if e := validateWebhook(endpoint); e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Hoshi-Monitor/1")
	req.Header.Set("Idempotency-Key", event)
	// Every delivery revalidates and pins DNS. Redirects cannot escape this policy.
	transport := &http.Transport{DialContext: func(ctx context.Context, _, address string) (net.Conn, error) {
		return safeDial(ctx, address, "ai", nil)
	}, TLSHandshakeTimeout: 5 * time.Second, MaxResponseHeaderBytes: 16 << 10}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if s.cfg.monitorHTTPClient != nil {
		client = s.cfg.monitorHTTPClient
	}
	res, e := client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return errors.New("webhook rejected event")
	}
	return nil
}
func (s *Server) alertDeliveries(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	rows, e := s.db.Query(r.Context(), "SELECT id,event_id,status,attempts,last_error,created_at FROM alert_deliveries WHERE host_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100", id, uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, event, status, message string
		var attempts int
		var created time.Time
		if e = rows.Scan(&id, &event, &status, &attempts, &message, &created); e != nil {
			break
		}
		out = append(out, map[string]any{"id": id, "eventID": event, "status": status, "attempts": attempts, "message": message, "createdAt": created})
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
