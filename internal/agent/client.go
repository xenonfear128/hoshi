package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"remoter/internal/agentproto"
)

type Config struct {
	ServerURL         string `json:"serverURL"`
	RegistrationToken string `json:"registrationToken,omitempty"`
	ReportToken       string `json:"reportToken,omitempty"`
	AgentID           string `json:"agentID"`
	// AllowHTTP is for an explicit isolated development environment only.
	AllowHTTP bool `json:"allowHTTP,omitempty"`
}
type Client struct {
	checkResults map[string]agentproto.CheckResult
	cfg          Config
	configPath   string
	collector    *Collector
	http         *http.Client
	mu           sync.Mutex
	settings     agentproto.Settings
	queue        []agentproto.Sample
	wake         chan struct{}
	ws           *websocket.Conn
	nextWS       time.Time
}

func ReadConfig(path string) (Config, error) {
	var c Config
	info, e := os.Lstat(path)
	if e != nil {
		return c, e
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 64<<10 {
		return c, errors.New("agent config must be a regular file readable only by its owner")
	}
	b, e := os.ReadFile(path)
	if e != nil {
		return c, e
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if e = d.Decode(&c); e != nil {
		return c, e
	}
	return c, validateServer(c)
}
func validateServer(c Config) error {
	u, e := url.Parse(c.ServerURL)
	if e != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && !(u.Scheme == "http" && c.AllowHTTP)) {
		return errors.New("agent server must be a bare HTTPS origin")
	}
	return nil
}
func atomicPrivate(path string, b []byte) error {
	dir := filepath.Dir(path)
	f, e := os.CreateTemp(dir, ".hoshi-")
	if e != nil {
		return e
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	if e == nil {
		e = f.Sync()
	}
	closeErr := f.Close()
	if e == nil {
		e = closeErr
	}
	if e != nil {
		return e
	}
	return os.Rename(tmp, path)
}
func WriteConfig(path string, c Config) error {
	b, e := json.MarshalIndent(c, "", "  ")
	if e != nil {
		return e
	}
	return atomicPrivate(path, b)
}
func New(c Config, path string) *Client {
	if c.AgentID == "" {
		c.AgentID = newID()
	}
	collector := NewCollector(agentproto.Version)
	collector.AgentID = c.AgentID
	return &Client{cfg: c, configPath: path, collector: collector, http: &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, settings: agentproto.DefaultSettings(), wake: make(chan struct{}, 1), checkResults: map[string]agentproto.CheckResult{}}
}
func (c *Client) saveConfig() error { return WriteConfig(c.configPath, c.cfg) }
func (c *Client) register(ctx context.Context) error {
	if c.cfg.RegistrationToken == "" {
		return errors.New("registration or report credential is required")
	}
	in := agentproto.RegisterRequest{Protocol: agentproto.ProtocolVersion, AgentID: c.cfg.AgentID, Version: agentproto.Version}
	var out agentproto.RegisterResponse
	if e := c.post(ctx, "/api/agent/register", c.cfg.RegistrationToken, in, &out); e != nil {
		return e
	}
	if len(out.ReportToken) < 32 {
		return errors.New("registration response is incomplete")
	}
	c.cfg.ReportToken = out.ReportToken
	c.cfg.RegistrationToken = ""
	if e := c.saveConfig(); e != nil {
		return errors.New("cannot persist agent credential")
	}
	return c.setSettings(out.Settings)
}
func (c *Client) setSettings(s agentproto.Settings) error {
	if e := s.Validate(); e != nil {
		return e
	}
	c.mu.Lock()
	c.settings = s
	if s.Paused {
		c.queue = nil
	}
	c.mu.Unlock()
	return nil
}
func (c *Client) queuePath() string { return c.configPath + ".buffer" }
func (c *Client) restoreQueue() {
	info, e := os.Lstat(c.queuePath())
	if e != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 32<<20 {
		return
	}
	b, e := os.ReadFile(c.queuePath())
	if e != nil {
		return
	}
	var q []agentproto.Sample
	if json.Unmarshal(b, &q) != nil {
		return
	}
	for _, s := range q {
		if s.AgentID == c.cfg.AgentID && s.Validate(time.Now()) == nil {

			c.queue = append(c.queue, s)
		}
	}
	if len(c.queue) > agentproto.MaxBufferedSamples {
		c.queue = c.queue[len(c.queue)-agentproto.MaxBufferedSamples:]
	}
}
func (c *Client) persistQueueLocked() error {
	b, e := json.Marshal(c.queue)
	if e != nil {
		return e
	}
	for len(b) > 32<<20 && len(c.queue) > 0 {
		c.queue = c.queue[1:]
		b, e = json.Marshal(c.queue)
		if e != nil {
			return e
		}
	}
	return atomicPrivate(c.queuePath(), b)
}
func (c *Client) collect(ctx context.Context, fail chan<- error) {
	for {
		c.mu.Lock()
		settings := c.settings
		c.mu.Unlock()
		start := time.Now()
		if !settings.Paused {
			limit, cancel := context.WithTimeout(ctx, 12*time.Second)
			s := c.collector.Sample(limit, settings)
			cancel()
			if ctx.Err() != nil {
				return
			}
			c.mu.Lock()
			if !c.settings.Paused {
				for id, result := range c.checkResults {
					if time.Since(result.CheckedAt) < time.Minute {
						s.Checks = append(s.Checks, result)
					}
					delete(c.checkResults, id)
				}
				c.queue = append(c.queue, s)
				if len(c.queue) > agentproto.MaxBufferedSamples {
					c.queue = c.queue[1:]
				}
			}
			e := c.persistQueueLocked()
			c.mu.Unlock()
			if e != nil {
				select {
				case fail <- errors.New("cannot persist metric buffer"):
				default:
				}
				return
			}
			select {
			case c.wake <- struct{}{}:
			default:
			}
		}
		delay := time.Duration(settings.IntervalSeconds)*time.Second - time.Since(start)
		if delay < 100*time.Millisecond {
			delay = 100 * time.Millisecond
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}
func (c *Client) Run(ctx context.Context) error {
	if e := validateServer(c.cfg); e != nil {
		return e
	}
	if e := c.saveConfig(); e != nil {
		return e
	}
	if c.cfg.ReportToken == "" {
		if e := c.register(ctx); e != nil {
			return e
		}
	}
	// Synchronize pause/config before starting collection after a restart.
	var initial agentproto.ReportResponse
	if e := c.post(ctx, "/api/agent/report", c.cfg.ReportToken, agentproto.ReportRequest{}, &initial); e == nil {
		if e = c.apply(initial); e != nil {
			return e
		}
	} else if errors.Is(e, errRevoked) {
		return e
	}
	if !c.settings.Paused {
		c.restoreQueue()
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	checkDone := make(chan struct{})
	go func() { defer close(checkDone); c.checkLoop(ctx) }()
	defer func() { cancel(); <-checkDone }()
	failed := make(chan error, 1)
	done := make(chan struct{})
	go func() { defer close(done); c.collect(ctx, failed) }()
	defer func() {
		cancel()
		<-done
		if c.ws != nil {
			c.ws.CloseNow()
		}
	}()
	backoff := time.Second
	for {
		c.mu.Lock()
		var sample *agentproto.Sample
		for len(c.queue) > 0 && c.queue[0].SampledAt.Before(time.Now().Add(-time.Hour+time.Minute)) {
			c.queue = c.queue[1:]
		}
		if len(c.queue) > 0 && !c.settings.Paused {
			copy := c.queue[0]
			sample = &copy
		}
		c.mu.Unlock()
		out, e := c.send(ctx, agentproto.ReportRequest{Sample: sample})
		if e == nil {
			if e = c.apply(out); e != nil {
				return e
			}
			if sample != nil {
				c.mu.Lock()
				for i, s := range c.queue {
					if s.SessionID == sample.SessionID && s.Sequence == sample.Sequence {
						c.queue = append(c.queue[:i], c.queue[i+1:]...)
						break
					}
				}
				e = c.persistQueueLocked()
				c.mu.Unlock()
				if e != nil {
					return e
				}
			}
			backoff = time.Second
		} else if errors.Is(e, errRevoked) {
			return e
		}
		c.mu.Lock()
		pending := len(c.queue)
		c.mu.Unlock()
		delay := time.Duration(0)
		if e != nil {
			delay = backoff + time.Duration(rand.Int64N(int64(backoff/2)))
			if backoff < 30*time.Second {
				backoff *= 2
			}
		}
		if e == nil && pending > 0 {
			delay = 100 * time.Millisecond
		} else if e == nil {
			delay = 10 * time.Second
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case e := <-failed:
			timer.Stop()
			return e
		case <-timer.C:
		case <-c.wake:
			if e == nil {
				timer.Stop()
			} else {
				select {
				case <-ctx.Done():
					timer.Stop()
					return ctx.Err()
				case <-timer.C:
				}
			}
		}
	}
}

var errRevoked = errors.New("agent credential revoked; renew the binding in Hoshi")

func (c *Client) apply(out agentproto.ReportResponse) error {
	if out.ReportToken != "" && out.ReportToken != c.cfg.ReportToken {
		c.cfg.ReportToken = out.ReportToken
		if e := c.saveConfig(); e != nil {
			return e
		}
		if c.ws != nil {
			c.ws.CloseNow()
			c.ws = nil
		}
	}
	return c.setSettings(out.Settings)
}
func (c *Client) send(ctx context.Context, in agentproto.ReportRequest) (agentproto.ReportResponse, error) {
	out := agentproto.ReportResponse{}
	if c.ws == nil && time.Now().After(c.nextWS) {
		target := strings.Replace(c.cfg.ServerURL, "https://", "wss://", 1)
		target = strings.Replace(target, "http://", "ws://", 1)
		dial, cancel := context.WithTimeout(ctx, 5*time.Second)
		ws, res, e := websocket.Dial(dial, target+"/api/agent/stream", &websocket.DialOptions{HTTPClient: c.http, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + c.cfg.ReportToken}}})
		cancel()
		if e == nil {
			c.ws = ws
			c.ws.SetReadLimit(128 << 10)
		} else {
			c.nextWS = time.Now().Add(time.Minute)
			if res != nil && res.StatusCode == 401 {
				return out, errRevoked
			}
		}
	}
	if c.ws != nil {
		deadline, cancel := context.WithTimeout(ctx, 15*time.Second)
		b, _ := json.Marshal(in)
		e := c.ws.Write(deadline, websocket.MessageText, b)
		if e == nil {
			var payload []byte
			_, payload, e = c.ws.Read(deadline)
			if e == nil {
				e = json.Unmarshal(payload, &out)
			}
		}
		cancel()
		if e == nil {
			return out, nil
		}
		c.ws.CloseNow()
		c.ws = nil
		c.nextWS = time.Now().Add(time.Minute)
	}
	e := c.post(ctx, "/api/agent/report", c.cfg.ReportToken, in, &out)
	return out, e
}
func (c *Client) post(ctx context.Context, path, secret string, in, out any) error {
	b, e := json.Marshal(in)
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.ServerURL+path, bytes.NewReader(b))
	if e != nil {
		return e
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+secret)
	res, e := c.http.Do(req)
	if e != nil {
		return errors.New("monitoring server unreachable")
	}
	defer res.Body.Close()
	if res.StatusCode == 401 {
		return errRevoked
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("monitoring endpoint returned status %d", res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 128<<10)).Decode(out)
}

// Slow or failed network targets never block hardware sampling or heartbeats.
func (c *Client) checkLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	type runningCheck struct {
		signature string
		next      time.Time
	}
	due := map[string]runningCheck{}
	slots := make(chan struct{}, 16)
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		c.mu.Lock()
		cfg := c.settings
		c.mu.Unlock()
		now := time.Now()
		if !cfg.Paused {
			for _, target := range cfg.Checks {
				signature := stringMustJSON(target)
				prior := due[target.ID]
				if prior.signature == signature && now.Before(prior.next) {
					continue
				}
				select {
				case slots <- struct{}{}:
				default:
					continue
				}
				due[target.ID] = runningCheck{signature, now.Add(time.Duration(target.IntervalSeconds) * time.Second)}
				wg.Go(func() {
					defer func() { <-slots }()
					r := Check(ctx, target)
					c.mu.Lock()
					defer c.mu.Unlock()
					if c.settings.Paused {
						return
					}
					for _, current := range c.settings.Checks {
						if current.ID == target.ID && stringMustJSON(current) == signature {
							c.checkResults[target.ID] = r
							break
						}
					}
				})
			}
		}
		active := map[string]bool{}
		for _, target := range cfg.Checks {
			active[target.ID] = true
		}
		for id := range due {
			if !active[id] {
				delete(due, id)
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func stringMustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
