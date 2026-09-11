package app

import (
	"context"
	"encoding/json"
	"github.com/coder/websocket"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const metricsCommand = `printf '\n__STAT__\n'; head -n 1 /proc/stat; printf '\n__MEM__\n'; cat /proc/meminfo; printf '\n__LOAD__\n'; cat /proc/loadavg; printf '\n__NET__\n'; cat /proc/net/dev; printf '\n__UP__\n'; cat /proc/uptime; printf '\n__DISK__\n'; df -Pk -x tmpfs -x devtmpfs 2>/dev/null; printf '\n__INFO__\n'; hostname; uname -sr; getconf _NPROCESSORS_ONLN`

type NetMetric struct {
	Received uint64 `json:"received"`
	Sent     uint64 `json:"sent"`
}
type DiskMetric struct {
	Mount string `json:"mount"`
	Total uint64 `json:"total"`
	Used  uint64 `json:"used"`
}
type Metrics struct {
	Source          string               `json:"source"`
	BootID          string               `json:"bootID,omitempty"`
	AgentStatus     string               `json:"agentStatus,omitempty"`
	Hostname        string               `json:"hostname"`
	System          string               `json:"system"`
	Cores           int                  `json:"cores"`
	Time            int64                `json:"time"`
	CPU             *float64             `json:"cpu"`
	MemoryTotal     uint64               `json:"memoryTotal"`
	MemoryAvailable uint64               `json:"memoryAvailable"`
	SwapTotal       uint64               `json:"swapTotal"`
	SwapFree        uint64               `json:"swapFree"`
	Load            []float64            `json:"load"`
	Network         map[string]NetMetric `json:"network"`
	Disks           []DiskMetric         `json:"disks"`
	Uptime          float64              `json:"uptime"`
	Error           string               `json:"error,omitempty"`
	total, idle     uint64
}

func parseMetrics(text string) Metrics {
	m := Metrics{Time: time.Now().UnixMilli(), Network: map[string]NetMetric{}, Disks: []DiskMetric{}, Load: []float64{}}
	section := ""
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "__") {
			section = line
			continue
		}
		f := strings.Fields(line)
		if len(f) == 0 {
			continue
		}
		switch section {
		case "__INFO__":
			if m.Hostname == "" {
				m.Hostname = line
			} else if m.System == "" {
				m.System = line
			} else {
				m.Cores, _ = strconv.Atoi(line)
			}
		case "__STAT__":
			if f[0] == "cpu" && len(f) >= 5 {
				for i := 1; i < len(f) && i <= 8; i++ {
					m.total += number(f[i])
				}
				m.idle = number(f[4])
				if len(f) > 5 {
					m.idle += number(f[5])
				}
			}
		case "__MEM__":
			if len(f) < 2 {
				continue
			}
			v := number(f[1]) * 1024
			switch f[0] {
			case "MemTotal:":
				m.MemoryTotal = v
			case "MemAvailable:":
				m.MemoryAvailable = v
			case "SwapTotal:":
				m.SwapTotal = v
			case "SwapFree:":
				m.SwapFree = v
			}
		case "__LOAD__":
			if len(f) >= 3 {
				for _, x := range f[:3] {
					n, _ := strconv.ParseFloat(x, 64)
					m.Load = append(m.Load, n)
				}
			}
		case "__NET__":
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				v := strings.Fields(parts[1])
				if len(v) >= 16 {
					m.Network[strings.TrimSpace(parts[0])] = NetMetric{number(v[0]), number(v[8])}
				}
			}
		case "__UP__":
			m.Uptime, _ = strconv.ParseFloat(f[0], 64)
		case "__DISK__":
			if len(f) >= 6 && f[0] != "Filesystem" {
				m.Disks = append(m.Disks, DiskMetric{strings.Join(f[5:], " "), number(f[1]) * 1024, number(f[2]) * 1024})
			}
		}
	}
	if m.total == 0 || m.MemoryTotal == 0 {
		m.Error = "Linux /proc metrics unavailable"
	}
	return m
}
func number(v string) uint64 { n, _ := strconv.ParseUint(v, 10, 64); return n }

type monitorHub struct {
	key, user, host string
	ctx             context.Context
	cancel          context.CancelFunc
	subscribers     map[chan Metrics]struct{}
}

func (s *Server) subscribeMetrics(c *Connection) (chan Metrics, func()) {
	key := c.userID + ":" + c.hostID
	s.mu.Lock()
	hub := s.monitors[key]
	if hub == nil {
		ctx, cancel := context.WithCancel(context.Background())
		hub = &monitorHub{key: key, user: c.userID, host: c.hostID, ctx: ctx, cancel: cancel, subscribers: map[chan Metrics]struct{}{}}
		s.monitors[key] = hub
		go s.collectMetrics(hub)
	}
	ch := make(chan Metrics, 1)
	hub.subscribers[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(hub.subscribers, ch)
		if len(hub.subscribers) == 0 {
			hub.cancel()
			if s.monitors[key] == hub {
				delete(s.monitors, key)
			}
		}
		s.mu.Unlock()
	}
}
func (s *Server) collectMetrics(hub *monitorHub) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	var prev Metrics
	var disks []DiskMetric
	var info Metrics
	iteration := 0
	for {
		s.mu.Lock()
		var source *Connection
		for _, c := range s.connections {
			if c.userID == hub.user && c.hostID == hub.host && c.ctx.Err() == nil {
				source = c
				break
			}
		}
		s.mu.Unlock()
		m := Metrics{Time: time.Now().UnixMilli(), Source: "ssh", Error: "no active collection connection"}
		agentMetric, available := s.agentWorkspaceMetrics(hub.host)
		if available {
			m = agentMetric
		} else if source != nil {
			command := metricsCommand
			if iteration%30 != 0 {
				if i := strings.Index(command, "; printf '\\n__DISK__\\n'"); i >= 0 {
					command = command[:i]
				}
			}
			ctx, cancel := context.WithTimeout(hub.ctx, 4*time.Second)
			text, e := source.run(ctx, command, 64<<10)
			cancel()
			m = parseMetrics(text)
			if m.Hostname != "" {
				info = m
			} else {
				m.Hostname = info.Hostname
				m.System = info.System
				m.Cores = info.Cores
			}
			if e != nil {
				m.Error = "resource collection unavailable"
			}
			if len(m.Disks) > 0 {
				disks = m.Disks
			} else {
				m.Disks = disks
			}
			if prev.total > 0 && m.total > prev.total && m.idle >= prev.idle {
				v := 100 * (1 - float64(m.idle-prev.idle)/float64(m.total-prev.total))
				if v >= 0 && v <= 100 {
					m.CPU = &v
				}
			}
			prev = m
		}
		if !available {
			m.Source = "ssh"
			m.AgentStatus = agentMetric.AgentStatus
		}
		iteration++
		s.mu.Lock()
		for ch := range hub.subscribers {
			select {
			case ch <- m:
			default:
				select {
				case <-ch:
				default:
				}
				select {
				case ch <- m:
				default:
				}
			}
		}
		s.mu.Unlock()
		select {
		case <-hub.ctx.Done():
			return
		case <-t.C:
		}
	}
}
func (s *Server) metrics(w http.ResponseWriter, r *http.Request) {
	c := s.connection(w, r)
	if c == nil {
		return
	}
	if r.Header.Get("Origin") != s.cfg.Origin {
		fail(w, 403, "invalid origin")
		return
	}
	ws, e := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{s.cfg.Origin}})
	if e != nil {
		return
	}
	defer ws.CloseNow()
	ctx := ws.CloseRead(c.ctx)
	samples, unsubscribe := s.subscribeMetrics(c)
	defer unsubscribe()
	for {
		select {
		case <-ctx.Done():
			return
		case m := <-samples:
			b, _ := json.Marshal(m)
			wc, cancel := context.WithTimeout(ctx, 5*time.Second)
			e := ws.Write(wc, websocket.MessageText, b)
			cancel()
			if e != nil {
				return
			}
		}
	}
}

func (s *Server) agentWorkspaceMetrics(host string) (Metrics, bool) {
	s.mu.Lock()
	ring := s.agentCache[host]
	var latest MonitorLatest
	if len(ring) > 0 {
		latest = ring[len(ring)-1]
	}
	s.mu.Unlock()
	m := Metrics{AgentStatus: "unavailable"}
	if latest.Sample == nil {
		return m, false
	}
	sample := latest.Sample
	// Agent interval is encoded by observed sample spacing; allow the configured 3s maximum.
	if time.Since(sample.SampledAt) > time.Duration(max(3, latest.IntervalSeconds*3))*time.Second {
		return m, false
	}
	m = Metrics{Source: "agent", AgentStatus: "online", BootID: sample.BootID, Hostname: sample.Hostname, System: sample.OS + " / " + sample.Kernel, Cores: sample.Cores, Time: sample.SampledAt.UnixMilli(), CPU: sample.CPU, MemoryTotal: sample.MemoryTotal, MemoryAvailable: sample.MemoryTotal - sample.MemoryUsed, SwapTotal: sample.SwapTotal, SwapFree: sample.SwapTotal - sample.SwapUsed, Uptime: float64(sample.Uptime), Network: map[string]NetMetric{}, Disks: []DiskMetric{}}
	if sample.Load != nil {
		m.Load = sample.Load[:]
	}
	for _, n := range sample.Network {
		m.Network[n.Name] = NetMetric{Received: n.RxBytes, Sent: n.TxBytes}
	}
	for _, d := range sample.Mounts {
		m.Disks = append(m.Disks, DiskMetric{Mount: d.Mount, Total: d.Total, Used: d.Used})
	}
	return m, true
}
