package agent

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"remoter/internal/agentproto"
)

func TestPrivateConfigAndTransportLifecycle(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	var mu sync.Mutex
	registrations := 0
	reports := 0
	stream := 0
	seen := make(chan struct{}, 32)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" {
			t.Error("token leaked into URL")
		}
		if r.URL.Path == "/api/agent/register" {
			if r.Header.Get("Authorization") != "Bearer register-secret" {
				http.Error(w, "denied", 401)
				return
			}
			mu.Lock()
			registrations++
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(agentproto.RegisterResponse{ReportToken: strings.Repeat("r", 43), Settings: agentproto.DefaultSettings()})
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("r", 43) {
			http.Error(w, "denied", 401)
			return
		}
		if r.URL.Path == "/api/agent/stream" {
			ws, e := websocket.Accept(w, r, nil)
			if e != nil {
				return
			}
			defer ws.CloseNow()
			mu.Lock()
			stream++
			mu.Unlock()
			for {
				_, b, e := ws.Read(r.Context())
				if e != nil {
					return
				}
				var in agentproto.ReportRequest
				_ = json.Unmarshal(b, &in)
				if in.Sample != nil {
					mu.Lock()
					reports++
					mu.Unlock()
					select {
					case seen <- struct{}{}:
					default:
					}
				}
				out, _ := json.Marshal(agentproto.ReportResponse{Accepted: true, Settings: agentproto.DefaultSettings()})
				if ws.Write(r.Context(), websocket.MessageText, out) != nil {
					return
				}
			}
		}
		_ = json.NewEncoder(w).Encode(agentproto.ReportResponse{Accepted: true, Settings: agentproto.DefaultSettings()})
	})
	server := httptest.NewTLSServer(handler)
	defer server.Close()
	cfg := Config{ServerURL: server.URL, RegistrationToken: "register-secret"}
	c := New(cfg, path)
	c.http = server.Client()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()
	select {
	case <-seen:
	case <-time.After(15 * time.Second):
		cancel()
		t.Fatal("agent did not report over TLS/WSS")
	}
	cancel()
	<-done
	saved, e := ReadConfig(path)
	if e != nil || saved.RegistrationToken != "" || saved.ReportToken == "" || saved.AgentID == "" {
		t.Fatalf("credential not persisted: %v", e)
	}
	c2 := New(saved, path)
	c2.http = server.Client()
	ctx, cancel = context.WithCancel(context.Background())
	go func() { done <- c2.Run(ctx) }()
	select {
	case <-seen:
	case <-time.After(15 * time.Second):
		cancel()
		t.Fatal("restarted agent did not report")
	}
	cancel()
	<-done
	mu.Lock()
	defer mu.Unlock()
	if registrations != 1 || reports < 2 || stream < 2 {
		t.Fatalf("lifecycle register=%d report=%d WSS=%d", registrations, reports, stream)
	}
	if e = os.Chmod(path, 0644); e != nil {
		t.Fatal(e)
	}
	if _, e = ReadConfig(path); e == nil {
		t.Fatal("world-readable agent credential accepted")
	}
}
func TestPostFallbackAndBoundedBuffer(t *testing.T) {
	count := 0
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/agent/stream" {
			http.Error(w, "no websocket", 403)
			return
		}
		count++
		_ = json.NewEncoder(w).Encode(agentproto.ReportResponse{Settings: agentproto.DefaultSettings(), Accepted: true})
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "config.json")
	c := New(Config{ServerURL: server.URL, ReportToken: "private-report", AgentID: "a"}, path)
	c.http = server.Client()
	if _, e := c.send(context.Background(), agentproto.ReportRequest{}); e != nil {
		t.Fatal(e)
	}
	if count != 1 || c.ws != nil {
		t.Fatal("POST fallback failed")
	}
	now := time.Now()
	for i := 0; i < 700; i++ {
		c.queue = append(c.queue, agentproto.Sample{Protocol: 1, AgentID: "a", BootID: "boot", SessionID: "s", Sequence: uint64(i + 1), SampledAt: now})
	}
	if e := c.persistQueueLocked(); e != nil {
		t.Fatal(e)
	}
	c.queue = nil
	c.restoreQueue()
	if len(c.queue) != agentproto.MaxBufferedSamples {
		t.Fatal("restored queue is unbounded")
	}
}
func TestChecksAndGPUAbsence(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	target := agentproto.CheckTarget{ID: "http", Kind: "http", URL: server.URL, TimeoutMS: 1000, IntervalSeconds: 10}
	if r := Check(context.Background(), target); r.Success || r.Unavailable {
		t.Fatalf("HTTP failure mislabeled: %+v", r)
	}
	addr := strings.TrimPrefix(server.URL, "http://")
	host, port, _ := net.SplitHostPort(addr)
	target = agentproto.CheckTarget{ID: "tcp", Kind: "tcp", Host: host, Port: mustPort(port), TimeoutMS: 1000, IntervalSeconds: 10}
	if r := Check(context.Background(), target); !r.Success {
		t.Fatalf("TCP failed: %+v", r)
	}
	target.Kind = "icmp"
	r := Check(context.Background(), target)
	if !r.Success && !r.Unavailable {
		t.Fatalf("ICMP echo validation failed: %v", r.Error)
	}
	g, e := parseNVIDIA([]byte("NVIDIA Test, 35, 8192, 1024, 52, 0\nNVIDIA Test 2, [N/A], 8192, [N/A], [N/A], 1\n"))
	if e != nil || len(g) != 2 || *g[0].Utilization != 35 || *g[0].MemoryUsed != 1073741824 || g[1].Utilization != nil {
		t.Fatal("GPU capabilities/absence parsing failed")
	}
}

func mustPort(s string) int { n, _ := strconv.Atoi(s); return n }
