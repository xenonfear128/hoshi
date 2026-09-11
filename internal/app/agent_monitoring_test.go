package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"remoter/internal/agentproto"
	"strings"
	"testing"
	"time"
)

func TestAgentRegisterReportAndLatest(t *testing.T) {
	dbURL := isolatedTestDB(t)
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	cfg := Config{DatabaseURL: dbURL, Key: bytes.Repeat([]byte{51}, 32), Origin: "http://agent.test", Registration: true, SessionTTL: time.Hour, AgentDir: "/tmp"}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	srv := httptest.NewServer(s.Handler())
	defer srv.Close()
	user, host := token(), token()
	if _, e = s.db.Exec(context.Background(), "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", user, user+"@agent.test", passwordHash("initial-long-password")); e != nil {
		t.Fatal(e)
	}
	defer s.db.Exec(context.Background(), "DELETE FROM users WHERE id=$1", user)
	h := Host{ID: host, Name: "agent-test", Address: "10.0.0.1", Port: 22, Username: "root", AuthType: "password"}
	plain, _ := json.Marshal(h)
	sealed, _ := s.vault.Seal(string(plain), user+":"+host+":host")
	if _, e = s.db.Exec(context.Background(), "INSERT INTO hosts(id,user_id,data) VALUES($1,$2,$3)", host, user, sealed); e != nil {
		t.Fatal(e)
	}
	session := token()
	if _, e = s.db.Exec(context.Background(), "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", digest(session), user); e != nil {
		t.Fatal(e)
	}
	cookie := "remoter_session=" + session
	request := func(method, path, auth string, v any) (int, []byte) {
		b, _ := json.Marshal(v)
		req, _ := http.NewRequest(method, srv.URL+path, bytes.NewReader(b))
		if !strings.HasPrefix(path, "/api/agent/") {
			req.Header.Set("Origin", cfg.Origin)
		}
		req.Header.Set("Cookie", cookie)
		req.Header.Set("Content-Type", "application/json")
		if auth != "" {
			req.Header.Set("Authorization", "Bearer "+auth)
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		out, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, out
	}
	status, _ := request("POST", "/api/hosts/"+host+"/agent", "", map[string]any{"settings": agentproto.DefaultSettings()})
	if status != 200 {
		t.Fatalf("enable: %d", status)
	}
	status, raw := request("POST", "/api/hosts/"+host+"/agent/registration", "", map[string]any{})
	if status != 200 {
		t.Fatalf("registration: %d %s", status, raw)
	}
	var reg struct {
		RegistrationToken string `json:"registrationToken"`
	}
	json.Unmarshal(raw, &reg)
	if reg.RegistrationToken == "" {
		t.Fatal("empty registration token")
	}
	sample := agentproto.Sample{Protocol: agentproto.ProtocolVersion, AgentID: "agent", BootID: "boot", SessionID: "session", Sequence: 1, SampledAt: time.Now().UTC(), Capabilities: agentproto.Capabilities{"cpu": "warming"}}
	rawReport := agentproto.ReportRequest{Sample: &sample}
	status, raw = request("POST", "/api/agent/register", reg.RegistrationToken, agentproto.RegisterRequest{Protocol: agentproto.ProtocolVersion, AgentID: "agent", Version: agentproto.Version})
	if status != 200 {
		t.Fatalf("register: %d %s", status, raw)
	}
	var registered agentproto.RegisterResponse
	json.Unmarshal(raw, &registered)
	if registered.ReportToken == "" {
		t.Fatal("empty report token")
	}
	status, raw = request("POST", "/api/agent/report", registered.ReportToken, "invalid")
	if status != 400 {
		t.Fatalf("invalid report accepted: %d %s", status, raw)
	}
	status, raw = request("POST", "/api/agent/report", registered.ReportToken, rawReport)
	if status != 200 {
		t.Fatalf("report: %d %s", status, raw)
	}

	// A registration credential is single use and cannot be exchanged twice.
	status, _ = request("POST", "/api/agent/register", reg.RegistrationToken, agentproto.RegisterRequest{Protocol: 1, AgentID: "agent", Version: agentproto.Version})
	if status != 401 {
		t.Fatal("registration replay accepted")
	}
	status, _ = request("POST", "/api/agent/report", registered.ReportToken, rawReport)
	if status != 200 {
		t.Fatal("duplicate report not acknowledged")
	}
	var samples int
	if e = s.db.QueryRow(context.Background(), "SELECT count(*) FROM metric_samples").Scan(&samples); e != nil || samples != 1 {
		t.Fatal("duplicate counted twice", e, samples)
	}
	sample.AgentID = "other-host"
	sample.Sequence = 2
	status, _ = request("POST", "/api/agent/report", registered.ReportToken, rawReport)
	if status != 401 {
		t.Fatal("agent identity substitution accepted")
	}
	sample.AgentID = "agent"
	// Owner isolation covers settings, history, raw samples, events, jobs and alerts.
	bob := token()
	_, e = s.db.Exec(context.Background(), "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", bob, bob+"@agent.test", passwordHash("initial-long-password"))
	if e != nil {
		t.Fatal(e)
	}
	bs := token()
	_, _ = s.db.Exec(context.Background(), "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", digest(bs), bob)
	savedCookie := cookie
	cookie = "remoter_session=" + bs
	for _, suffix := range []string{"agent", "agent/jobs", "monitor", "monitor/history", "monitor/raw", "monitor/events", "alerts", "alerts/deliveries"} {
		status, _ = request("GET", "/api/hosts/"+host+"/"+suffix, "", nil)
		if status != 404 {
			t.Fatalf("owner isolation %s: %d", suffix, status)
		}
	}
	status, _ = request("DELETE", "/api/hosts/"+host+"/agent", "", nil)
	if status != 404 {
		t.Fatal("cross-owner revocation")
	}
	cookie = savedCookie
	// Pausing rejects new samples but returns configuration so the process can resume.
	settings := agentproto.DefaultSettings()
	settings.Paused = true
	status, raw = request("PUT", "/api/hosts/"+host+"/agent", "", map[string]any{"settings": settings})
	if status != 200 {
		t.Fatalf("pause %d %s", status, raw)
	}
	status, raw = request("POST", "/api/agent/report", registered.ReportToken, rawReport)
	var ack agentproto.ReportResponse
	_ = json.Unmarshal(raw, &ack)
	if status != 200 || ack.Accepted || !ack.Settings.Paused {
		t.Fatalf("pause ingest %d %s", status, raw)
	}
	settings.Paused = false
	status, _ = request("PUT", "/api/hosts/"+host+"/agent", "", map[string]any{"settings": settings})
	if status != 200 {
		t.Fatal("resume failed")
	}
	status, _ = request("POST", "/api/hosts/"+host+"/agent/rotate", "", map[string]any{})
	if status != 200 {
		t.Fatal("rotate failed")
	}
	status, raw = request("POST", "/api/agent/report", registered.ReportToken, agentproto.ReportRequest{})
	_ = json.Unmarshal(raw, &ack)
	newToken := ack.ReportToken
	if status != 200 || newToken == "" {
		t.Fatalf("rotation delivery %d %s", status, raw)
	}
	status, _ = request("POST", "/api/agent/report", newToken, agentproto.ReportRequest{})
	if status != 200 {
		t.Fatal("new credential rejected")
	}
	status, _ = request("POST", "/api/agent/report", registered.ReportToken, agentproto.ReportRequest{})
	if status != 401 {
		t.Fatal("old credential still works after rotation acknowledgement")
	}
	// Delayed backfill cannot recover an offline agent.
	_, _ = s.db.Exec(context.Background(), "UPDATE agent_bindings SET last_current=now()-interval '5 minutes'")
	sample.SampledAt = time.Now().Add(-time.Minute)
	sample.Sequence = 3
	status, raw = request("POST", "/api/agent/report", newToken, rawReport)
	if status != 200 {
		t.Fatalf("backfill %d %s", status, raw)
	}
	status, raw = request("GET", "/api/hosts/"+host+"/agent", "", nil)
	var state AgentInfo
	_ = json.Unmarshal(raw, &state)
	if state.Status != "offline" {
		t.Fatalf("backfill caused recovery %s", raw)
	}
	status, raw = request("GET", "/api/hosts/"+host+"/monitor", "", nil)
	if status != 200 || !strings.Contains(string(raw), `"source":"agent"`) {
		t.Fatalf("latest: %d %s", status, raw)
	}
	status, _ = request("DELETE", "/api/hosts/"+host+"/agent", "", nil)
	if status != 200 {
		t.Fatal("revoke failed")
	}
	status, _ = request("POST", "/api/agent/report", newToken, rawReport)
	if status != 401 {
		t.Fatal("revoked report accepted")
	}

}

func TestMonitoringKeyRotationAndWebhook(t *testing.T) {
	dbURL := isolatedTestDB(t)
	cfg := Config{DatabaseURL: dbURL, Key: bytes.Repeat([]byte{61}, 32), Origin: "https://monitor.test", SessionTTL: time.Hour}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	s.stopMaintenance()
	s.agentWorkers.Wait()
	owner, host, binding := token(), token(), token()
	ctx := context.Background()
	_, e = s.db.Exec(ctx, "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", owner, owner+"@example.com", passwordHash("test-long-password"))
	if e != nil {
		t.Fatal(e)
	}
	hostCipher, _ := s.vault.Seal(`{"name":"secret node"}`, owner+":"+host+":host")
	_, e = s.db.Exec(ctx, "INSERT INTO hosts(id,user_id,data) VALUES($1,$2,$3)", host, owner, hostCipher)
	if e != nil {
		t.Fatal(e)
	}
	ac := agentproto.DefaultSettings()
	ac.QuotaBytes = 1000
	ac.Interfaces = []string{"eth0"}
	cfgCipher, _ := s.sealMonitor(owner, host, "agent-config", ac)
	_, e = s.db.Exec(ctx, "INSERT INTO agent_bindings(id,user_id,host_id,config,agent_id,report_digest) VALUES($1,$2,$3,$4,'agent',$5)", binding, owner, host, cfgCipher, digest("report"))
	if e != nil {
		t.Fatal(e)
	}
	now := time.Now().UTC()
	value := 91.0
	sample := agentproto.Sample{Protocol: 1, AgentID: "agent", BootID: "boot", SessionID: "session", Sequence: 1, SampledAt: now.Add(-3 * time.Second), CPU: &value, Network: []agentproto.NetworkSample{{Name: "eth0", Index: 1, RxBytes: 100, TxBytes: 100}}}
	if _, e = s.ingestAgent(ctx, binding, "report", agentproto.ReportRequest{Sample: &sample}); e != nil {
		t.Fatal(e)
	}
	sample.Sequence++
	sample.SampledAt = now
	sample.Network[0].RxBytes = 2000
	if _, e = s.ingestAgent(ctx, binding, "report", agentproto.ReportRequest{Sample: &sample}); e != nil {
		t.Fatal(e)
	}
	deliveries := 0
	webhook := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Idempotency-Key") == "" {
			t.Error("webhook event has no idempotency key")
		}
		deliveries++
		w.WriteHeader(204)
	}))
	defer webhook.Close()
	s.cfg.monitorHTTPClient = webhook.Client()
	alert := defaultAlertConfig()
	alert.WebhookURL = webhook.URL
	alert.CPUPercent = 90
	alert.DurationSeconds = 5
	encrypted, _ := s.sealMonitor(owner, host, "alert-config", alert)
	_, e = s.db.Exec(ctx, "INSERT INTO alert_rules(host_id,user_id,config) VALUES($1,$2,$3)", host, owner, encrypted)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.evaluateHostAlerts(ctx, host, now); e != nil {
		t.Fatal(e)
	}
	if e = s.evaluateHostAlerts(ctx, host, now.Add(5*time.Second)); e != nil {
		t.Fatal(e)
	}
	if e = s.deliverPendingAlerts(ctx); e != nil {
		t.Fatal(e)
	}
	if deliveries < 2 {
		t.Fatalf("expected CPU and quota delivery, got %d", deliveries)
	}
	s.cfg.monitorHTTPClient = nil
	if e = s.sendMonitorWebhook(ctx, "https://127.0.0.1/private", nil, "blocked"); e == nil {
		t.Fatal("private webhook was not blocked")
	}

	next := bytes.Repeat([]byte{62}, 32)
	s.Close()
	if e = RotateKey(ctx, cfg, next); e != nil {
		t.Fatal("monitor vault rotation", e)
	}
	cfg.Key = next
	s, e = New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	b, e := scanBinding(s.db.QueryRow(ctx, "SELECT "+bindingColumns+" FROM agent_bindings WHERE id=$1", binding))
	if e != nil {
		t.Fatal(e)
	}
	var latest MonitorLatest
	if e = s.openMonitor(owner, host, "agent-latest", b.Latest, &latest); e != nil || latest.Sample == nil {
		t.Fatal("latest ciphertext not rotated", e)
	}
	var raw string
	var step int
	var bucket time.Time
	e = s.db.QueryRow(ctx, "SELECT step,bucket,data FROM metric_rollups WHERE host_id=$1 LIMIT 1", host).Scan(&step, &bucket, &raw)
	if e != nil {
		t.Fatal(e)
	}
	var point Rollup
	if e = s.openMonitor(owner, host, monitorAAD(step, bucket), raw, &point); e != nil || point.Count == 0 {
		t.Fatal("history ciphertext not rotated", e)
	}
}
