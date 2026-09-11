package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestVaultBindsOwnerAndDetectsTampering(t *testing.T) {
	v, e := NewVault(bytes.Repeat([]byte{7}, 32))
	if e != nil {
		t.Fatal(e)
	}
	a, e := v.Seal("ssh-secret", "alice:host")
	if e != nil {
		t.Fatal(e)
	}
	b, _ := v.Seal("ssh-secret", "alice:host")
	if a == b {
		t.Fatal("nonce reused")
	}
	p, e := v.Open(a, "alice:host")
	if e != nil || p != "ssh-secret" {
		t.Fatal("roundtrip failed")
	}
	if _, e = v.Open(a, "bob:host"); e == nil {
		t.Fatal("cross-account decrypt allowed")
	}
	raw := []byte(a)
	raw[len(raw)-3] ^= 1
	if _, e = v.Open(string(raw), "alice:host"); e == nil {
		t.Fatal("tampered data accepted")
	}
}
func TestPasswordAndRedaction(t *testing.T) {
	h := passwordHash("correct horse battery staple")
	if !passwordMatch("correct horse battery staple", h) || passwordMatch("wrong", h) {
		t.Fatal("password verification broken")
	}
	out := redact("password=hunter2 api_key=sk-123 Authorization: Bearer abcdef\n-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----")
	for _, secret := range []string{"hunter2", "sk-123", "abcdef", "\nsecret\n"} {
		if strings.Contains(out, secret) {
			t.Errorf("secret remains: %s", secret)
		}
	}
}
func TestNetworkPolicy(t *testing.T) {
	cases := []struct {
		ip, kind string
		allowed  bool
	}{{"127.0.0.1", "ssh", false}, {"169.254.169.254", "ssh", false}, {"10.0.1.3", "ssh", true}, {"10.0.1.3", "ai", false}, {"::ffff:127.0.0.1", "ai", false}, {"::1", "ssh", false}, {"8.8.8.8", "ai", true}, {"100.100.100.200", "ai", false}, {"100.100.100.200", "ssh", false}, {"64:ff9b::7f00:1", "ai", false}}
	for _, c := range cases {
		if got := allowedAddress(netip.MustParseAddr(c.ip), c.kind, nil); got != c.allowed {
			t.Errorf("%s %s=%v", c.ip, c.kind, got)
		}
	}
	if !allowedAddress(netip.MustParseAddr("127.0.0.1"), "ssh", []string{"127.0.0.1/32"}) {
		t.Fatal("explicit exception denied")
	}
	for _, u := range []string{"http://example.com/v1", "https://user:pass@example.com/v1", "https://example.com/v1?key=x"} {
		if validAIURL(u) == nil {
			t.Errorf("unsafe URL accepted: %s", u)
		}
	}
}
func TestMetricParsing(t *testing.T) {
	m := parseMetrics("__STAT__\ncpu 100 0 50 800 20 0 0 0 100 0\n__MEM__\nMemTotal: 1000 kB\nMemAvailable: 400 kB\nSwapTotal: 500 kB\nSwapFree: 500 kB\n__LOAD__\n0.1 0.2 0.3 1/1 42\n__NET__\n eth0: 123 0 0 0 0 0 0 0 456 0 0 0 0 0 0 0\n__UP__\n86400.0 0\n__DISK__\n/dev/sda 1000 200 800 20% /\n")
	if m.total != 970 || m.idle != 820 || m.MemoryTotal != 1024000 || m.Network["eth0"].Sent != 456 || len(m.Disks) != 1 || m.Disks[0].Used != 204800 {
		t.Fatalf("incorrect metric: %+v", m)
	}
}
func TestIntegrationIsolationAndSSH(t *testing.T) {
	db := isolatedTestDB(t)
	if db == "" {
		t.Skip("TEST_DATABASE_URL is required")
	}
	cfg := Config{DatabaseURL: db, Key: bytes.Repeat([]byte{19}, 32), Origin: "http://remoter.test", Registration: true, SessionTTL: time.Hour, SSHAllowedCIDRs: []string{"127.0.0.1/32"}, AdminToken: strings.Repeat("b", 32)}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	var users []string
	defer func() {
		for _, id := range users {
			s.db.Exec(context.Background(), "DELETE FROM ai_tasks WHERE user_id=$1", id)
			s.db.Exec(context.Background(), "DELETE FROM credit_events WHERE user_id=$1", id)
			s.db.Exec(context.Background(), "DELETE FROM users WHERE id=$1", id)
		}
	}()
	request := func(method, path, cookie, origin string, v any) (int, []byte, *http.Response) {
		t.Helper()
		var data []byte
		if v != nil {
			data, _ = json.Marshal(v)
		}
		req, _ := http.NewRequest(method, server.URL+path, bytes.NewReader(data))
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		req.Header.Set("Content-Type", "application/json")
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, b, res
	}
	register := func() string {
		t.Helper()
		status, b, res := request("POST", "/api/register", "", cfg.Origin, map[string]string{"email": token() + "@example.com", "password": "a-long-test-password"})
		if status != 200 {
			t.Fatalf("register %d %s", status, b)
		}
		var u map[string]string
		json.Unmarshal(b, &u)
		users = append(users, u["id"])
		return res.Cookies()[0].Name + "=" + res.Cookies()[0].Value
	}
	alice, bob := register(), register()
	status, _, _ := request("POST", "/api/hosts", alice, "https://evil.example", map[string]string{})
	if status != 403 {
		t.Fatal("CSRF not rejected")
	}
	keyPath := os.Getenv("TEST_SSH_KEY")
	if keyPath == "" {
		t.Fatal("TEST_SSH_KEY required for integration")
	}
	key, e := os.ReadFile(keyPath)
	if e != nil {
		t.Fatal(e)
	}
	status, b, _ := request("POST", "/api/hosts", alice, cfg.Origin, hostInput{Host: Host{Name: "private production", Address: "127.0.0.1", Port: 22222, Username: "root", AuthType: "key"}, Credential: &Credential{PrivateKey: string(key)}})
	if status != 200 {
		t.Fatalf("create %d %s", status, b)
	}
	var h Host
	json.Unmarshal(b, &h)
	var encrypted, secret string
	s.db.QueryRow(context.Background(), "SELECT data,credential FROM hosts WHERE id=$1", h.ID).Scan(&encrypted, &secret)
	if strings.Contains(encrypted, "production") || strings.Contains(secret, "PRIVATE KEY") {
		t.Fatal("plaintext in database")
	}
	status, b, _ = request("GET", "/api/hosts", bob, "", nil)
	if status != 200 || strings.TrimSpace(string(b)) != "[]" {
		t.Fatal("host leaked to another account")
	}
	for _, method := range []string{"PUT", "DELETE"} {
		status, _, _ = request(method, "/api/hosts/"+h.ID, bob, cfg.Origin, hostInput{Host: h})
		if status != 404 {
			t.Fatalf("cross-account %s returned %d", method, status)
		}
	}
	status, _, _ = request("POST", "/api/hosts/"+h.ID+"/connect", alice, cfg.Origin, map[string]any{})
	if status != 409 {
		t.Fatal("untrusted connection allowed")
	}
	status, b, _ = request("POST", "/api/hosts/"+h.ID+"/probe", alice, cfg.Origin, map[string]any{})
	if status != 200 {
		t.Fatalf("probe %d %s", status, b)
	}
	var fp map[string]any
	json.Unmarshal(b, &fp)
	status, b, _ = request("POST", "/api/hosts/"+h.ID+"/trust", alice, cfg.Origin, map[string]any{"fingerprint": fp["fingerprint"], "previous": ""})
	if status != 200 {
		t.Fatalf("trust %d %s", status, b)
	}
	status, b, _ = request("POST", "/api/hosts/"+h.ID+"/connect", alice, cfg.Origin, map[string]any{})
	if status != 200 {
		t.Fatalf("connect %d %s", status, b)
	}
	var con map[string]string
	json.Unmarshal(b, &con)
	cid := con["id"]
	status, _, _ = request("GET", "/api/connections/"+cid+"/files", bob, "", nil)
	if status != 404 {
		t.Fatal("cross-account connection accessible")
	}
	status, b, _ = request("GET", "/api/connections/"+cid+"/files?path=/tmp", alice, "", nil)
	if status != 200 {
		t.Fatalf("SFTP %d %s", status, b)
	}
	s.mu.Lock()
	c := s.connections[cid]
	s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, e := c.run(ctx, "printf remoter-integration-ok", 1024)
	if e != nil || out != "remoter-integration-ok" {
		t.Fatalf("command failed %q %v", out, e)
	}
	wsURL := strings.Replace(server.URL, "http://", "ws://", 1) + "/api/connections/" + cid + "/terminal"
	ws, _, e := websocket.Dial(ctx, wsURL, &websocket.DialOptions{HTTPHeader: http.Header{
		"Cookie": []string{alice},
		"Origin": []string{cfg.Origin},
	}})
	if e != nil {
		t.Fatalf("terminal websocket handshake failed: %v", e)
	}
	defer ws.Close(websocket.StatusNormalClosure, "test complete")
	if e = ws.Write(ctx, websocket.MessageText, []byte(`{"type":"input","data":"printf TERMINAL_WS_OK\\n"}`)); e != nil {
		t.Fatal("terminal input failed:", e)
	}
	ws.SetReadLimit(32 << 10)
	var terminalOutput strings.Builder
	for terminalOutput.Len() < 4096 {
		kind, data, readErr := ws.Read(ctx)
		if readErr != nil {
			t.Fatal("terminal output failed:", readErr)
		}
		if kind == websocket.MessageBinary || kind == websocket.MessageText {
			terminalOutput.Write(data)
			if strings.Contains(terminalOutput.String(), "TERMINAL_WS_OK") {
				break
			}
		}
	}
	if !strings.Contains(terminalOutput.String(), "TERMINAL_WS_OK") {
		t.Fatal(fmt.Sprintf("terminal output missing marker: %q", terminalOutput.String()))
	}
	p := "/tmp/remoter-file-" + token()
	defer c.files.Remove(p)
	status, b, _ = request("POST", "/api/connections/"+cid+"/files", alice, cfg.Origin, map[string]string{"operation": "create", "path": p})
	if status != 200 {
		t.Fatalf("file create %d %s", status, b)
	}
	status, b, _ = request("GET", "/api/connections/"+cid+"/text?path="+p, alice, "", nil)
	if status != 200 {
		t.Fatal("text read failed")
	}
	var text map[string]string
	json.Unmarshal(b, &text)
	status, b, _ = request("PUT", "/api/connections/"+cid+"/text", alice, cfg.Origin, map[string]string{"path": p, "content": "hello world", "version": text["version"]})
	if status != 200 {
		t.Fatalf("save %d %s", status, b)
	}
	status, _, _ = request("PUT", "/api/connections/"+cid+"/text", alice, cfg.Origin, map[string]string{"path": p, "content": "stale overwrite", "version": text["version"]})
	if status != 409 {
		t.Fatal("stale overwrite accepted")
	}
	uploadURL := server.URL + "/api/connections/" + cid + "/upload?path=" + url.QueryEscape(p) + "&overwrite=true"
	payload := bytes.Repeat([]byte("transfer-integrity-"), 1<<20)
	uploadReq, _ := http.NewRequest("POST", uploadURL, bytes.NewReader(payload))
	uploadReq.Header.Set("Origin", cfg.Origin)
	uploadReq.Header.Set("Cookie", alice)
	uploadRes, err := http.DefaultClient.Do(uploadReq)
	if err != nil {
		t.Fatal(err)
	}
	uploadReply, _ := io.ReadAll(uploadRes.Body)
	uploadRes.Body.Close()
	if uploadRes.StatusCode != 200 {
		t.Fatalf("large upload %d %s", uploadRes.StatusCode, uploadReply)
	}
	downloadReq, _ := http.NewRequest("GET", server.URL+"/api/connections/"+cid+"/download?path="+url.QueryEscape(p), nil)
	downloadReq.Header.Set("Cookie", alice)
	downloadRes, err := http.DefaultClient.Do(downloadReq)
	if err != nil {
		t.Fatal(err)
	}
	downloaded, _ := io.ReadAll(downloadRes.Body)
	downloadRes.Body.Close()
	if !bytes.Equal(downloaded, payload) {
		t.Fatal("large transfer integrity failed")
	}
	interruptedPath := p + "-cancelled"
	defer c.files.Remove(interruptedPath)
	pipeReader, pipeWriter := io.Pipe()
	cancelCtx, stopUpload := context.WithCancel(context.Background())
	cancelReq, _ := http.NewRequestWithContext(cancelCtx, "POST", server.URL+"/api/connections/"+cid+"/upload?path="+url.QueryEscape(interruptedPath), pipeReader)
	cancelReq.Header.Set("X-Upload-Size", "1048576")
	cancelReq.Header.Set("Origin", cfg.Origin)
	cancelReq.Header.Set("Cookie", alice)
	uploadDone := make(chan struct{})
	go func() {
		defer close(uploadDone)
		res, _ := http.DefaultClient.Do(cancelReq)
		if res != nil {
			res.Body.Close()
		}
	}()
	pipeWriter.Write([]byte("partial data"))
	stopUpload()
	pipeWriter.Close()
	select {
	case <-uploadDone:
	case <-time.After(5 * time.Second):
		t.Fatal("upload cancellation hung")
	}
	if _, err = c.files.Stat(interruptedPath); err == nil {
		t.Fatal("partial upload committed")
	}
	textPath := p + "-escaped"
	defer c.files.Remove(textPath)
	status, b, _ = request("POST", "/api/connections/"+cid+"/files", alice, cfg.Origin, map[string]string{"operation": "create", "path": textPath})
	if status != 200 {
		t.Fatal(string(b))
	}
	largeText := strings.Repeat("\n", 600000)
	status, b, _ = request("PUT", "/api/connections/"+cid+"/text", alice, cfg.Origin, map[string]string{"path": textPath, "content": largeText, "version": hashBytes(nil)})
	if status != 200 {
		t.Fatalf("escaped text save failed: %d %s", status, b)
	}
	originalFP := fp["fingerprint"].(string)
	s.db.Exec(context.Background(), "UPDATE hosts SET fingerprint='SHA256:wrong' WHERE id=$1", h.ID)
	status, _, _ = request("POST", "/api/hosts/"+h.ID+"/connect", alice, cfg.Origin, map[string]any{})
	if status != 409 {
		t.Fatal("changed host fingerprint accepted")
	}
	s.db.Exec(context.Background(), "UPDATE hosts SET fingerprint=$1 WHERE id=$2", originalFP, h.ID)
	for _, path := range []string{p, textPath} {
		if err := c.files.Remove(path); err != nil {
			t.Fatalf("remove fixture %s: %v", path, err)
		}
	}
	status, _, _ = request("POST", "/api/logout", alice, cfg.Origin, map[string]any{})
	if status != 200 {
		t.Fatal("logout failed")
	}
	select {
	case <-c.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("logout did not close connection")
	}
	status, _, _ = request("GET", "/api/me", alice, "", nil)
	if status != 401 {
		t.Fatal("session remains valid")
	}
}

func TestKeyRotationIntegration(t *testing.T) {
	dbURL := isolatedTestDB(t)
	if dbURL == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	pool, e := pgxpool.New(context.Background(), dbURL)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	schema := "rotate_" + strings.ToLower(digest(token())[:16])
	if _, e = pool.Exec(context.Background(), "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	defer pool.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
	u, _ := url.Parse(dbURL)
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	cfg := Config{DatabaseURL: u.String(), Key: bytes.Repeat([]byte{41}, 32), Origin: "http://rotate.test", SessionTTL: time.Hour}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	user, id := token(), token()
	_, e = s.db.Exec(context.Background(), "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", user, strings.ToLower(user)+"@example.com", passwordHash("initial-long-password"))
	if e != nil {
		t.Fatal(e)
	}
	data, _ := s.vault.Seal(`{"name":"rotation-test"}`, user+":"+id+":host")
	secret, _ := s.vault.Seal(`{"password":"rotation-private-secret"}`, user+":"+id+":credential")
	_, e = s.db.Exec(context.Background(), "INSERT INTO hosts(id,user_id,data,credential) VALUES($1,$2,$3,$4)", id, user, data, secret)
	if e != nil {
		t.Fatal(e)
	}
	next := bytes.Repeat([]byte{42}, 32)
	if e = RotateKey(context.Background(), cfg, next); e == nil {
		t.Fatal("rotation while app running allowed")
	}
	s.Close()
	if e = RotateKey(context.Background(), cfg, next); e != nil {
		t.Fatal(e)
	}
	cfg.Key = next
	s, e = New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	defer s.db.Exec(context.Background(), "DELETE FROM users WHERE id=$1", user)
	var cipher string
	if e = s.db.QueryRow(context.Background(), "SELECT credential FROM hosts WHERE id=$1", id).Scan(&cipher); e != nil {
		t.Fatal(e)
	}
	plain, e := s.vault.Open(cipher, user+":"+id+":credential")
	if e != nil || !strings.Contains(plain, "rotation-private-secret") {
		t.Fatal("rotated credential cannot decrypt")
	}
	if e = ResetPassword(context.Background(), cfg, user+"@example.com", "replacement-strong-password"); e != nil {
		t.Fatal(e)
	}
	var hash string
	s.db.QueryRow(context.Background(), "SELECT password_hash FROM users WHERE id=$1", user).Scan(&hash)
	if !passwordMatch("replacement-strong-password", hash) {
		t.Fatal("reset password not applied")
	}
}

func isolatedTestDB(t *testing.T) string {
	t.Helper()
	raw := os.Getenv("TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	pool, e := pgxpool.New(context.Background(), raw)
	if e != nil {
		t.Fatal(e)
	}
	schema := "test_" + digest(token())[:16]
	if _, e = pool.Exec(context.Background(), "CREATE SCHEMA "+schema); e != nil {
		pool.Close()
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE"); pool.Close() })
	u, e := url.Parse(raw)
	if e != nil {
		t.Fatal(e)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	return u.String()
}

func TestConcurrentReservationsAndRecovery(t *testing.T) {
	cfg := Config{DatabaseURL: isolatedTestDB(t), Key: bytes.Repeat([]byte{52}, 32), Origin: "http://recovery.test", SessionTTL: time.Hour}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	user, id := token(), token()
	_, e = s.db.Exec(context.Background(), "INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)", user, strings.ToLower(user)+"@example.com", passwordHash("long-recovery-password"))
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.db.Exec(context.Background(), "INSERT INTO credits(user_id,balance) VALUES($1,100)", user)
	if e != nil {
		t.Fatal(e)
	}
	_, e = s.db.Exec(context.Background(), "INSERT INTO ai_usage(id,user_id,source,model,reserved,status) VALUES($1,$2,'subscription','test',50,'pending')", id, user)
	if e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.settle(context.Background(), id, user, "subscription", 50, 7, 3, "complete")
		}()
	}
	wg.Wait()
	var balance int64
	s.db.QueryRow(context.Background(), "SELECT balance FROM credits WHERE user_id=$1", user).Scan(&balance)
	if balance != 140 {
		t.Fatalf("concurrent settlement double-refunded %d", balance)
	}
	pending := token()
	s.db.Exec(context.Background(), "INSERT INTO ai_usage(id,user_id,source,model,reserved,status) VALUES($1,$2,'subscription','test',60,'pending')", pending, user)
	s.Close()
	s, e = New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	s.db.QueryRow(context.Background(), "SELECT balance FROM credits WHERE user_id=$1", user).Scan(&balance)
	if balance != 200 {
		t.Fatalf("restart did not refund pending reservation: %d", balance)
	}
	s.Close()
	s, e = New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	s.db.QueryRow(context.Background(), "SELECT balance FROM credits WHERE user_id=$1", user).Scan(&balance)
	if balance != 200 {
		t.Fatal("restart refunded twice")
	}
}

func TestProxyHeadersCannotSpoofUntrustedPeers(t *testing.T) {
	cidrs := []string{"172.16.0.0/12"}
	if got := trustedClientIP("8.8.8.8", "1.1.1.1", cidrs); got != "8.8.8.8" {
		t.Fatal("untrusted forwarded header accepted")
	}
	if got := trustedClientIP("172.18.0.2", "9.9.9.9, 1.1.1.1", cidrs); got != "1.1.1.1" {
		t.Fatal("wrong trusted proxy chain client")
	}
	if got := trustedClientIP("172.18.0.2", "invalid", cidrs); got != "172.18.0.2" {
		t.Fatal("malformed header accepted")
	}
}
