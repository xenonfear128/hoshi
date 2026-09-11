package app

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestStreamAndWebhookSignatures(t *testing.T) {
	var latest string
	in := `data: {"choices":[{"delta":{"content":"hello "}}]}

data: {"choices":[{"delta":{"content":"world"}}]}

data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3}}

data: [DONE]

`
	text, a, b, done, e := readAIStream(strings.NewReader(in), func(s string) { latest = s })
	if e != nil || !done || text != "hello world" || latest != text || a != 7 || b != 3 {
		t.Fatalf("stream: %q %d %d %v %v", text, a, b, done, e)
	}
	_, _, _, done, _ = readAIStream(strings.NewReader("data: {\"choices\":[]}\n"), func(string) {})
	if done {
		t.Fatal("truncated stream accepted")
	}
	now := time.Now()
	payload := []byte(`{"id":"evt_test"}`)
	sig := stripeSignature(payload, "test-secret", now)
	if !verifyStripe(payload, sig, "test-secret", now) || verifyStripe(payload, sig, "wrong", now) || verifyStripe(payload, sig, "test-secret", now.Add(6*time.Minute)) {
		t.Fatal("webhook signature verification broken")
	}
}
func stripeSignature(b []byte, key string, now time.Time) string {
	ts := strconv.FormatInt(now.Unix(), 10)
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(ts + "."))
	mac.Write(b)
	return "t=" + ts + ",v1=" + hex.EncodeToString(mac.Sum(nil))
}
func TestAIIntegration(t *testing.T) {
	db := isolatedTestDB(t)
	if db == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	var calls atomic.Int32
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer provider-test-key" {
			t.Error("provider authentication missing")
		}
		var v struct {
			Messages []Message `json:"messages"`
			Stream   bool      `json:"stream"`
		}
		json.NewDecoder(r.Body).Decode(&v)
		for _, m := range v.Messages {
			if strings.Contains(m.Content, "secret-password-value") {
				t.Error("secret sent to model")
			}
		}
		if v.Stream {
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"```sh\\nprintf AI_COMMAND_OK\\n```\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5}}\n\ndata: [DONE]\n\n")
			return
		}
		plan := `{"summary":"检查测试连接","steps":[{"command":"printf AI_EXECUTION_OK","explanation":"输出测试标记","risk":"read"}]}`
		respond(w, 200, map[string]any{"choices": []any{map[string]any{"message": Message{"assistant", plan}}}, "usage": map[string]int{"prompt_tokens": 10, "completion_tokens": 5}})
	}))
	defer provider.Close()
	pool := x509.NewCertPool()
	pool.AddCert(provider.Certificate())
	cfg := Config{DatabaseURL: db, Key: bytes.Repeat([]byte{25}, 32), Origin: "http://ai.test", Registration: true, SessionTTL: time.Hour, SSHAllowedCIDRs: []string{"127.0.0.1/32"}, AIAllowedCIDRs: []string{"127.0.0.1/32"}, aiRootCAs: pool, SubscriptionURL: provider.URL, SubscriptionKey: "provider-test-key", SubscriptionModel: "test-model", AdminToken: strings.Repeat("a", 32), StripeWebhookSecret: "webhook-secret", StripePriceID: "price_test", SubscriptionCredits: 100000}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	cookie := ""
	user := ""
	defer func() {
		s.db.Exec(context.Background(), "DELETE FROM billing_events WHERE user_id=$1", user)
		s.db.Exec(context.Background(), "DELETE FROM credit_events WHERE user_id=$1", user)
		s.db.Exec(context.Background(), "DELETE FROM users WHERE id=$1", user)
	}()
	req := func(method, p string, v any) (int, []byte) {
		t.Helper()
		b, _ := json.Marshal(v)
		r, _ := http.NewRequest(method, server.URL+p, bytes.NewReader(b))
		r.Header.Set("Origin", cfg.Origin)
		r.Header.Set("Cookie", cookie)
		r.Header.Set("Content-Type", "application/json")
		if p == "/api/billing/credit" {
			r.Header.Set("Authorization", "Bearer "+cfg.AdminToken)
		}
		if p == "/api/billing/webhook" {
			r.Header.Set("Stripe-Signature", stripeSignature(b, cfg.StripeWebhookSecret, time.Now()))
		}
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		if len(res.Cookies()) > 0 {
			cookie = res.Cookies()[0].Name + "=" + res.Cookies()[0].Value
		}
		out, _ := io.ReadAll(res.Body)
		return res.StatusCode, out
	}
	status, b := req("POST", "/api/register", map[string]string{"email": token() + "@example.com", "password": "strong-test-password"})
	if status != 200 {
		t.Fatalf("register %s", b)
	}
	var u map[string]string
	json.Unmarshal(b, &u)
	user = u["id"]
	status, b = req("PUT", "/api/ai/settings", AISettings{Source: "byok", BaseURL: provider.URL, Model: "test-model", APIKey: "provider-test-key"})
	if status != 200 || strings.Contains(string(b), "provider-test-key") {
		t.Fatalf("BYOK secret echoed: %d", status)
	}
	var encryptedKey string
	s.db.QueryRow(context.Background(), "SELECT secret FROM ai_settings WHERE user_id=$1", user).Scan(&encryptedKey)
	if strings.Contains(encryptedKey, "provider-test-key") {
		t.Fatal("BYOK key stored in plaintext")
	}
	status, b = req("POST", "/api/ai/chat", map[string]any{"messages": []Message{{"user", "explain uptime"}}})
	if status != 200 {
		t.Fatalf("BYOK call %s", b)
	}
	calls.Store(0)
	status, b = req("PUT", "/api/ai/settings", AISettings{Source: "subscription"})
	if status != 200 {
		t.Fatal(string(b))
	}
	status, _ = req("POST", "/api/ai/chat", map[string]any{"messages": []Message{{"user", "hello"}}})
	if status != 502 || calls.Load() != 0 {
		t.Fatal("insufficient credit called provider")
	}
	eventID := token()
	for i := 0; i < 2; i++ {
		status, b = req("POST", "/api/billing/credit", map[string]any{"id": eventID, "userId": user, "amount": 100000})
		if status != 200 {
			t.Fatalf("credit %s", b)
		}
	}
	var balance int64
	s.db.QueryRow(context.Background(), "SELECT balance FROM credits WHERE user_id=$1", user).Scan(&balance)
	if balance != 100000 {
		t.Fatal("duplicate credit applied")
	}
	status, _ = req("POST", "/api/billing/credit", map[string]any{"id": eventID, "userId": user, "amount": 999})
	if status != 409 {
		t.Fatal("conflicting event accepted")
	}
	status, b = req("POST", "/api/ai/chat", map[string]any{"messages": []Message{{"user", "password=secret-password-value Explain printf"}}})
	if status != 200 {
		t.Fatalf("chat %d %s", status, b)
	}
	s.db.QueryRow(context.Background(), "SELECT balance FROM credits WHERE user_id=$1", user).Scan(&balance)
	if balance != 99985 {
		t.Fatalf("settlement incorrect %d", balance)
	}
	var streamed string
	answer, e := s.modelCall(context.Background(), user, []Message{{"user", "generate a command"}}, true, func(v string) { streamed = v })
	if e != nil || answer != streamed || !strings.Contains(answer, "AI_COMMAND_OK") {
		t.Fatalf("stream integration %q %v", answer, e)
	}
	key, e := os.ReadFile(os.Getenv("TEST_SSH_KEY"))
	if e != nil {
		t.Fatal(e)
	}
	status, b = req("POST", "/api/hosts", hostInput{Host: Host{Name: "ai-test", Address: "127.0.0.1", Port: 22222, Username: "root", AuthType: "key"}, Credential: &Credential{PrivateKey: string(key)}})
	if status != 200 {
		t.Fatal(string(b))
	}
	var h Host
	json.Unmarshal(b, &h)
	_, b = req("POST", "/api/hosts/"+h.ID+"/probe", map[string]any{})
	var fp map[string]any
	json.Unmarshal(b, &fp)
	req("POST", "/api/hosts/"+h.ID+"/trust", map[string]any{"fingerprint": fp["fingerprint"], "previous": ""})
	status, b = req("POST", "/api/hosts/"+h.ID+"/connect", map[string]any{})
	if status != 200 {
		t.Fatalf("connect %s", b)
	}
	var c map[string]string
	json.Unmarshal(b, &c)
	status, b = req("POST", "/api/tasks", nil)
	if status != 404 {
		t.Fatal("unknown API path did not return 404")
	}
	status, b = req("POST", "/api/ai/tasks", map[string]string{"hostId": h.ID, "request": "执行测试检查"})
	if status != 200 {
		t.Fatalf("plan %d %s", status, b)
	}
	var task Task
	json.Unmarshal(b, &task)
	status, _ = req("POST", "/api/ai/tasks/"+task.ID+"/execute", map[string]string{"connectionId": c["id"], "planHash": "tampered", "confirmHost": h.ID, "confirmName": h.Name})
	if status != 409 {
		t.Fatal("tampered plan authorized")
	}
	approval := map[string]string{"connectionId": c["id"], "planHash": task.PlanHash, "confirmHost": h.ID, "confirmName": h.Name}
	status, b = req("POST", "/api/ai/tasks/"+task.ID+"/execute", approval)
	if status != 200 || !strings.Contains(string(b), "AI_EXECUTION_OK") || !strings.Contains(string(b), "event: done") {
		t.Fatalf("execute %d %s", status, b)
	}
	status, _ = req("POST", "/api/ai/tasks/"+task.ID+"/execute", approval)
	if status != 409 {
		t.Fatal("approval replay accepted")
	}
	s.mu.Lock()
	conn := s.connections[c["id"]]
	s.mu.Unlock()
	ch1, unsub1 := s.subscribeMetrics(conn)
	ch2, unsub2 := s.subscribeMetrics(conn)
	select {
	case <-ch1:
	case <-time.After(6 * time.Second):
		t.Fatal("metrics subscriber timed out")
	}
	select {
	case <-ch2:
	case <-time.After(6 * time.Second):
		t.Fatal("shared metrics subscriber timed out")
	}
	s.mu.Lock()
	hubCount := len(s.monitors)
	s.mu.Unlock()
	if hubCount != 1 {
		t.Fatal("monitor collection not shared")
	}
	unsub1()
	unsub2()
	s.mu.Lock()
	hubCount = len(s.monitors)
	s.mu.Unlock()
	if hubCount != 0 {
		t.Fatal("monitor hub leaked")
	}
	cancelTask := Task{ID: token(), HostID: h.ID, Request: "cancel test", Summary: "test", Status: "planned", PlanHash: "cancel-hash", Steps: []Step{{Command: "sleep 30; printf MUST_NOT_RUN", Risk: "danger"}}}
	taskBytes, _ := json.Marshal(cancelTask)
	taskData, _ := s.vault.Seal(string(taskBytes), user+":"+cancelTask.ID+":task")
	s.db.Exec(context.Background(), "INSERT INTO ai_tasks(id,user_id,host_id,data) VALUES($1,$2,$3,$4)", cancelTask.ID, user, h.ID, taskData)
	var runStatus int
	var runBody []byte
	var wait sync.WaitGroup
	wait.Add(1)
	go func() {
		defer wait.Done()
		runStatus, runBody = req("POST", "/api/ai/tasks/"+cancelTask.ID+"/execute", map[string]string{"connectionId": c["id"], "planHash": cancelTask.PlanHash, "confirmHost": h.ID, "confirmName": h.Name})
	}()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var state string
		s.db.QueryRow(context.Background(), "SELECT status FROM ai_tasks WHERE id=$1", cancelTask.ID).Scan(&state)
		if state == "running" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	status, b = req("POST", "/api/ai/tasks/"+cancelTask.ID+"/cancel", map[string]any{})
	if status != 200 {
		t.Fatal(string(b))
	}
	wait.Wait()
	if runStatus != 200 || !strings.Contains(string(runBody), `"status":"cancelled"`) {
		t.Fatalf("cancellation failed %d %s", runStatus, runBody)
	}
	customer := "cus_" + token()
	status, b = req("POST", "/api/billing/webhook", map[string]any{"id": "evt_" + token(), "type": "checkout.session.completed", "data": map[string]any{"object": map[string]string{"customer": customer, "client_reference_id": user, "mode": "subscription"}}})
	if status != 200 {
		t.Fatal(string(b))
	}
	invoice := "in_" + token()
	for i := 0; i < 2; i++ {
		status, b = req("POST", "/api/billing/webhook", map[string]any{"id": "evt_" + token(), "type": "invoice.paid", "data": map[string]any{"object": map[string]any{"id": invoice, "customer": customer, "paid": true, "billing_reason": "subscription_cycle", "lines": map[string]any{"data": []any{map[string]any{"price": map[string]string{"id": "price_test"}, "quantity": 1}}}}}})
		if status != 200 {
			t.Fatalf("invoice %d %s", status, b)
		}
	}
	s.db.QueryRow(context.Background(), "SELECT balance FROM credits WHERE user_id=$1", user).Scan(&balance)
	if balance != 199940 {
		t.Fatalf("invoice dedupe failed: %d", balance)
	}
}

func TestCheckoutContract(t *testing.T) {
	databaseURL := isolatedTestDB(t)
	var creates atomic.Int32
	var active atomic.Bool
	var resumed atomic.Bool
	provider := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name, _, ok := r.BasicAuth()
		if !ok || name != "stripe-test-key" {
			t.Error("missing Stripe authentication")
		}
		switch r.URL.Path {
		case "/checkout/sessions":
			creates.Add(1)
			r.ParseForm()
			if r.Form.Get("line_items[0][price]") != "price_test" || r.Form.Get("mode") != "subscription" || r.Form.Get("subscription_data[metadata][remoter_user_id]") == "" {
				t.Error("server-controlled checkout fields absent")
			}
			if r.Form.Get("customer") == "cus_existing" {
				resumed.Store(true)
			}
			respond(w, 200, map[string]any{"url": "https://checkout.stripe.com/c/pay/test"})
		case "/subscriptions":
			items := []any{}
			if active.Load() {
				items = append(items, map[string]string{"status": "active"})
			}
			respond(w, 200, map[string]any{"data": items, "has_more": false})
		case "/billing_portal/sessions":
			respond(w, 200, map[string]any{"url": "https://billing.stripe.com/p/session/test"})
		default:
			fail(w, 404, "unknown endpoint")
		}
	}))
	defer provider.Close()
	cfg := Config{DatabaseURL: databaseURL, Key: bytes.Repeat([]byte{62}, 32), Origin: "http://billing.test", Registration: true, SessionTTL: time.Hour, StripeKey: "stripe-test-key", StripeWebhookSecret: "secret", StripePriceID: "price_test", SubscriptionCredits: 10000, SubscriptionURL: "https://provider.example/v1", SubscriptionModel: "test", SubscriptionKey: "test", stripeBaseURL: provider.URL + "/", stripeClient: provider.Client()}
	s, e := New(context.Background(), cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	server := httptest.NewServer(s.Handler())
	defer server.Close()
	cookie := ""
	request := func(p string, v any) (int, []byte) {
		b, _ := json.Marshal(v)
		r, _ := http.NewRequest("POST", server.URL+p, bytes.NewReader(b))
		r.Header.Set("Origin", cfg.Origin)
		r.Header.Set("Cookie", cookie)
		res, e := http.DefaultClient.Do(r)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		if len(res.Cookies()) > 0 {
			cookie = res.Cookies()[0].Name + "=" + res.Cookies()[0].Value
		}
		out, _ := io.ReadAll(res.Body)
		return res.StatusCode, out
	}
	status, b := request("/api/register", map[string]string{"email": token() + "@example.com", "password": "strong-billing-password"})
	if status != 200 {
		t.Fatal(string(b))
	}
	var user map[string]string
	json.Unmarshal(b, &user)
	for i := 0; i < 2; i++ {
		status, b = request("/api/billing/checkout", map[string]string{"price": "attacker_price"})
		if status != 200 {
			t.Fatalf("checkout %d %s", status, b)
		}
	}
	if creates.Load() != 1 {
		t.Fatal("repeated checkout created duplicate sessions")
	}
	s.db.Exec(context.Background(), "INSERT INTO billing_customers(user_id,customer_id) VALUES($1,'cus_existing')", user["id"])
	active.Store(true)
	status, _ = request("/api/billing/checkout", map[string]any{})
	if status != 409 {
		t.Fatal("duplicate active subscription allowed")
	}
	s.mu.Lock()
	s.limits = map[string]*bucket{}
	s.mu.Unlock()
	active.Store(false)
	s.db.Exec(context.Background(), "DELETE FROM billing_checkouts WHERE user_id=$1", user["id"])
	status, b = request("/api/billing/checkout", map[string]any{})
	if status != 200 || !resumed.Load() {
		t.Fatalf("resubscribe failed %d %s", status, b)
	}
	status, b = request("/api/billing/portal", map[string]any{})
	if status != 200 || !strings.Contains(string(b), "billing.stripe.com") {
		t.Fatalf("portal failed %s", b)
	}
}
