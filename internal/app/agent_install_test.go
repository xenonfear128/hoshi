package app

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"remoter/internal/agent"
	"remoter/internal/agentproto"
)

// This opt-in fixture uses only localhost:22222 and an otherwise unused service
// name. It exercises real SSH, SFTP, systemd, TLS registration and reports.
func TestAgentSystemdLifecycle(t *testing.T) {
	if os.Getenv("TEST_AGENT_LIFECYCLE") != "true" {
		t.Skip("opt-in disposable Linux systemd fixture required")
	}
	for _, path := range []string{"/var/lib/hoshi-agent", "/usr/local/lib/hoshi-agent", "/etc/systemd/system/hoshi-agent.service"} {
		if _, e := os.Lstat(path); !os.IsNotExist(e) {
			t.Fatalf("refusing to touch existing installation: %s", path)
		}
	}
	if exec.Command("id", "hoshi-agent").Run() == nil {
		t.Fatal("fixture service user already exists")
	}
	ctx := context.Background()
	endpoint := httptest.NewUnstartedServer(nil)
	cfg := Config{DatabaseURL: isolatedTestDB(t), Key: bytes.Repeat([]byte{71}, 32), Origin: "https://" + endpoint.Listener.Addr().String(), SessionTTL: time.Hour, SSHAllowedCIDRs: []string{"127.0.0.1/32"}, AgentDir: os.Getenv("TEST_AGENT_DIR")}
	s, e := New(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	endpoint.Config.Handler = s.Handler()
	endpoint.StartTLS()
	defer endpoint.Close()
	// Trust only the fixture certificate during this explicit test. The actual
	// installed agent and curl still use their normal certificate verification.
	certPath := "/usr/local/share/ca-certificates/hoshi-lifecycle-fixture.crt"
	if _, e := os.Lstat(certPath); !os.IsNotExist(e) {
		t.Fatal("fixture certificate already exists")
	}
	if e = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: endpoint.Certificate().Raw}), 0644); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		exec.Command("systemctl", "stop", "hoshi-agent.service").Run()
		exec.Command("systemctl", "disable", "hoshi-agent.service").Run()
		os.Remove("/etc/systemd/system/hoshi-agent.service")
		os.RemoveAll("/var/lib/hoshi-agent")
		os.RemoveAll("/usr/local/lib/hoshi-agent")
		exec.Command("systemctl", "daemon-reload").Run()
		exec.Command("userdel", "hoshi-agent").Run()
		os.Remove(certPath)
		exec.Command("update-ca-certificates").Run()
	})
	if out, e := exec.Command("update-ca-certificates").CombinedOutput(); e != nil {
		t.Fatalf("trust fixture: %v %s", e, out)
	}
	owner, session := token(), token()
	_, e = s.db.Exec(ctx, "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", owner, owner+"@lifecycle.test", passwordHash("private-fixture-password"))
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.db.Exec(ctx, "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", digest(session), owner)
	if e != nil {
		t.Fatal(e)
	}
	request := func(method, path string, input any) []byte {
		req, _ := http.NewRequest(method, endpoint.URL+"/api"+path, bytes.NewReader(jsonBytes(input)))
		req.Header.Set("Origin", cfg.Origin)
		req.Header.Set("Cookie", "remoter_session="+session)
		res, err := endpoint.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		if res.StatusCode != 200 {
			t.Fatalf("%s %s: %d %s", method, path, res.StatusCode, data)
		}
		return data
	}
	key, e := os.ReadFile(os.Getenv("TEST_SSH_KEY"))
	if e != nil {
		t.Fatal(e)
	}
	var h Host
	json.Unmarshal(request("POST", "/hosts", hostInput{Host: Host{Name: "systemd fixture", Address: "127.0.0.1", Port: 22222, Username: "root", AuthType: "key"}, Credential: &Credential{PrivateKey: string(key)}}), &h)
	path := "/hosts/" + h.ID
	var probe struct {
		Fingerprint string `json:"fingerprint"`
	}
	json.Unmarshal(request("POST", path+"/probe", nil), &probe)
	request("POST", path+"/trust", map[string]string{"fingerprint": probe.Fingerprint, "previous": ""})
	settings := agentproto.DefaultSettings()
	request("POST", path+"/agent", map[string]any{"settings": settings})
	start := func(kind string) string {
		var jobs []AgentJob
		json.Unmarshal(request("POST", path+"/agent/jobs", map[string]string{"kind": kind}), &jobs)
		if len(jobs) == 0 {
			t.Fatal("no durable job")
		}
		return jobs[0].ID
	}
	waitJob := func(id string) {
		deadline := time.Now().Add(50 * time.Second)
		for time.Now().Before(deadline) {
			var status, message string
			e := s.db.QueryRow(ctx, "SELECT status,message FROM agent_install_jobs WHERE id=$1", id).Scan(&status, &message)
			if e != nil {
				t.Fatal(e)
			}
			if status == "complete" {
				return
			}
			if status == "failed" {
				t.Fatalf("lifecycle failed: %s", message)
			}
			time.Sleep(200 * time.Millisecond)
		}
		out, _ := exec.Command("journalctl", "-u", "hoshi-agent", "-n", "12", "--no-pager").CombinedOutput()
		t.Fatalf("job timed out: %s", out)
	}
	install := start("install")
	if duplicate := start("install"); duplicate != install {
		t.Fatal("duplicate install created another task")
	}
	waitJob(install)
	stored, e := agent.ReadConfig("/var/lib/hoshi-agent/config.json")
	if e != nil || stored.ReportToken == "" || stored.RegistrationToken != "" {
		t.Fatal("private registration was not exchanged", e)
	}
	info, e := os.Stat("/var/lib/hoshi-agent/config.json")
	if e != nil || info.Mode().Perm() != 0600 {
		t.Fatal("private config permissions", e)
	}
	out, e := exec.Command("systemctl", "show", "hoshi-agent", "--property=User", "--value").Output()
	if e != nil || string(out) != "hoshi-agent\n" {
		t.Fatal("service does not use dedicated account")
	}
	var before, after MonitorLatest
	var raw string
	s.db.QueryRow(ctx, "SELECT latest FROM agent_bindings WHERE host_id=$1", h.ID).Scan(&raw)
	s.openMonitor(owner, h.ID, "agent-latest", raw, &before)
	waitJob(start("upgrade"))
	s.db.QueryRow(ctx, "SELECT latest FROM agent_bindings WHERE host_id=$1", h.ID).Scan(&raw)
	s.openMonitor(owner, h.ID, "agent-latest", raw, &after)
	if before.Sample == nil || after.Sample == nil || before.Sample.SessionID == after.Sample.SessionID || after.Sample.Version != agentproto.Version {
		t.Fatal("upgrade completed on an old report")
	}
	settings.Paused = true
	request("PUT", path+"/agent", map[string]any{"settings": settings})
	settings.Paused = false
	request("PUT", path+"/agent", map[string]any{"settings": settings})
	request("POST", path+"/agent/rotate", nil)
	deadline := time.Now().Add(20 * time.Second)
	rotated := false
	for time.Now().Before(deadline) {
		current, err := agent.ReadConfig("/var/lib/hoshi-agent/config.json")
		if err == nil && current.ReportToken != stored.ReportToken {
			rotated = true
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !rotated {
		t.Fatal("running agent did not persist rotated credential")
	}
	waitJob(start("uninstall"))
	for _, name := range []string{"/etc/systemd/system/hoshi-agent.service", "/var/lib/hoshi-agent/config.json", "/usr/local/lib/hoshi-agent/hoshi-agent"} {
		if _, err := os.Stat(name); !os.IsNotExist(err) {
			t.Fatalf("uninstall left %s", filepath.Base(name))
		}
	}
	waitJob(start("uninstall")) // Repeat is safe after partial or completed removal.
	var enabled bool
	s.db.QueryRow(ctx, "SELECT enabled FROM agent_bindings WHERE host_id=$1", h.ID).Scan(&enabled)
	if enabled {
		t.Fatal("uninstall did not revoke access")
	}
	t.Log(fmt.Sprintf("real SSH/systemd lifecycle verified for %s", agentproto.Version))
}
