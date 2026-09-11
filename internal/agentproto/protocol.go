// Package agentproto defines Hoshi's monitoring-only protocol. It deliberately
// contains no arbitrary command, terminal, or file operation.
package agentproto

import (
	"errors"
	"math"
	"net"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const ProtocolVersion = 1
const Version = "0.1.0"
const MaxBody = 512 << 10
const MaxBufferedSamples = 600

// State is explicit when a collector cannot distinguish a zero from unavailable.
// Values: available, warming, unsupported, permission, unavailable, disabled.
type Capabilities map[string]string

type Settings struct {
	IntervalSeconds   int           `json:"intervalSeconds"`
	Interfaces        []string      `json:"interfaces"`
	ExcludeInterfaces []string      `json:"excludeInterfaces"`
	Mounts            []string      `json:"mounts"`
	ExcludeMounts     []string      `json:"excludeMounts"`
	BillingDay        int           `json:"billingDay"`
	Timezone          string        `json:"timezone"`
	QuotaBytes        uint64        `json:"quotaBytes"`
	Paused            bool          `json:"paused"`
	GPU               bool          `json:"gpu"`
	Checks            []CheckTarget `json:"checks"`
}

func DefaultSettings() Settings {
	return Settings{IntervalSeconds: 3, BillingDay: 1, Timezone: "UTC", GPU: true, Interfaces: []string{}, ExcludeInterfaces: []string{}, Mounts: []string{}, ExcludeMounts: []string{}, Checks: []CheckTarget{}}
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func ValidID(s string) bool { return identifier.MatchString(s) }
func (s Settings) Validate() error {
	if s.IntervalSeconds != 1 && s.IntervalSeconds != 3 {
		return errors.New("sampling interval must be 1 or 3 seconds")
	}
	if s.BillingDay < 1 || s.BillingDay > 28 || s.QuotaBytes > 1<<60 {
		return errors.New("invalid billing period or quota")
	}
	if _, e := time.LoadLocation(s.Timezone); e != nil {
		return errors.New("invalid billing timezone")
	}
	for _, list := range [][]string{s.Interfaces, s.ExcludeInterfaces, s.Mounts, s.ExcludeMounts} {
		if len(list) > 64 {
			return errors.New("too many filters")
		}
		for _, v := range list {
			if len(v) == 0 || len(v) > 256 || strings.ContainsAny(v, "\x00\n\r") {
				return errors.New("invalid metric filter")
			}
		}
	}
	if len(s.Checks) > 16 {
		return errors.New("at most 16 network targets per host")
	}
	ids := map[string]bool{}
	for _, c := range s.Checks {
		if e := c.Validate(); e != nil {
			return e
		}
		if ids[c.ID] {
			return errors.New("duplicate check ID")
		}
		ids[c.ID] = true
	}
	return nil
}

type NetworkSample struct {
	Name      string `json:"name"`
	RxBytes   uint64 `json:"rxBytes"`
	TxBytes   uint64 `json:"txBytes"`
	RxPackets uint64 `json:"rxPackets"`
	TxPackets uint64 `json:"txPackets"`
	RxErrors  uint64 `json:"rxErrors"`
	TxErrors  uint64 `json:"txErrors"`
	RxDrops   uint64 `json:"rxDrops"`
	TxDrops   uint64 `json:"txDrops"`
	Index     int    `json:"index"`
	Default   bool   `json:"default"`
}
type MountSample struct {
	Mount  string `json:"mount"`
	Device string `json:"device"`
	Total  uint64 `json:"total"`
	Used   uint64 `json:"used"`
	Free   uint64 `json:"free"`
}
type DiskIOSample struct {
	Name       string `json:"name"`
	ReadBytes  uint64 `json:"readBytes"`
	WriteBytes uint64 `json:"writeBytes"`
	ReadOps    uint64 `json:"readOps"`
	WriteOps   uint64 `json:"writeOps"`
}
type GPU struct {
	Index       int      `json:"index"`
	Name        string   `json:"name"`
	Utilization *float64 `json:"utilization"`
	MemoryTotal *uint64  `json:"memoryTotal"`
	MemoryUsed  *uint64  `json:"memoryUsed"`
	Temperature *float64 `json:"temperature"`
}

type Sample struct {
	Protocol     int             `json:"protocol"`
	AgentID      string          `json:"agentID"`
	BootID       string          `json:"bootID"`
	SessionID    string          `json:"sessionID"`
	Sequence     uint64          `json:"sequence"`
	SampledAt    time.Time       `json:"sampledAt"`
	Version      string          `json:"version"`
	Hostname     string          `json:"hostname"`
	OS           string          `json:"os"`
	Kernel       string          `json:"kernel"`
	Arch         string          `json:"arch"`
	Cores        int             `json:"cores"`
	Uptime       uint64          `json:"uptime"`
	CPU          *float64        `json:"cpu"`
	PerCoreCPU   []float64       `json:"perCoreCPU"`
	MemoryTotal  uint64          `json:"memoryTotal"`
	MemoryUsed   uint64          `json:"memoryUsed"`
	SwapTotal    uint64          `json:"swapTotal"`
	SwapUsed     uint64          `json:"swapUsed"`
	Load         *[3]float64     `json:"load"`
	Processes    *int            `json:"processes"`
	TCP          *int            `json:"tcp"`
	UDP          *int            `json:"udp"`
	Network      []NetworkSample `json:"network"`
	Mounts       []MountSample   `json:"mounts"`
	Disks        []DiskIOSample  `json:"disks"`
	GPUs         []GPU           `json:"gpus"`
	Checks       []CheckResult   `json:"checks"`
	Capabilities Capabilities    `json:"capabilities"`
}

func (s Sample) Validate(now time.Time) error {
	if s.Protocol != ProtocolVersion || !ValidID(s.AgentID) || !ValidID(s.BootID) || !ValidID(s.SessionID) || s.Sequence == 0 || s.Sequence > math.MaxInt64 {
		return errors.New("invalid sample identity")
	}
	if s.SampledAt.Before(now.Add(-time.Hour)) || s.SampledAt.After(now.Add(30*time.Second)) {
		return errors.New("sample timestamp outside accepted window")
	}
	if len(s.Version) > 64 || len(s.Hostname) > 253 || len(s.Kernel) > 256 || len(s.OS) > 256 || len(s.Arch) > 32 || s.Cores < 0 || s.Cores > 4096 {
		return errors.New("invalid host metadata")
	}
	if len(s.Network) > 128 || len(s.Mounts) > 128 || len(s.Disks) > 256 || len(s.PerCoreCPU) > 4096 || len(s.GPUs) > 32 || len(s.Checks) > 16 || len(s.Capabilities) > 32 {
		return errors.New("sample dimensions exceed limit")
	}
	valid := func(x float64, max float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) && x >= 0 && x <= max }
	if s.CPU != nil && !valid(*s.CPU, 100) {
		return errors.New("invalid CPU value")
	}
	for _, x := range s.PerCoreCPU {
		if !valid(x, 100) {
			return errors.New("invalid CPU value")
		}
	}
	if s.MemoryUsed > s.MemoryTotal || s.SwapUsed > s.SwapTotal {
		return errors.New("invalid memory counters")
	}
	if s.Load != nil {
		for _, v := range s.Load {
			if !valid(v, 1e9) {
				return errors.New("invalid load")
			}
		}
	}
	for _, n := range []*int{s.Processes, s.TCP, s.UDP} {
		if n != nil && (*n < 0 || *n > 1e9) {
			return errors.New("invalid process or connection count")
		}
	}
	names := map[string]bool{}
	label := func(kind, name string) bool {
		key := kind + name
		if len(name) == 0 || len(name) > 512 || strings.ContainsAny(name, "\x00\r\n") || names[key] {
			return false
		}
		names[key] = true
		return true
	}
	for _, n := range s.Network {
		if !label("net", n.Name) || n.Index < 0 {
			return errors.New("invalid interface")
		}
	}
	for _, m := range s.Mounts {
		if !label("mount", m.Mount) || len(m.Device) > 512 || m.Used > m.Total || m.Free > m.Total {
			return errors.New("invalid mount")
		}
	}
	for _, d := range s.Disks {
		if !label("disk", d.Name) {
			return errors.New("invalid disk")
		}
	}
	for _, g := range s.GPUs {
		if g.Index < 0 || g.Index > 1024 || len(g.Name) > 256 {
			return errors.New("invalid GPU")
		}
		if g.Utilization != nil && !valid(*g.Utilization, 100) {
			return errors.New("invalid GPU utilization")
		}
		if g.Temperature != nil && (!valid(*g.Temperature+100, 500)) {
			return errors.New("invalid GPU temperature")
		}
		if g.MemoryTotal != nil && g.MemoryUsed != nil && *g.MemoryUsed > *g.MemoryTotal {
			return errors.New("invalid GPU memory")
		}
	}
	for _, c := range s.Checks {
		if !ValidID(c.TargetID) || !valid(c.LatencyMS, 30000) || len(c.Error) > 128 || c.CheckedAt.After(s.SampledAt.Add(time.Second)) || c.CheckedAt.Before(s.SampledAt.Add(-time.Minute)) {
			return errors.New("invalid check result")
		}
	}
	return nil
}

type RegisterRequest struct {
	Protocol int    `json:"protocol"`
	AgentID  string `json:"agentID"`
	Version  string `json:"version"`
}
type RegisterResponse struct {
	ReportToken string   `json:"reportToken"`
	Settings    Settings `json:"settings"`
}
type ReportRequest struct {
	Sample *Sample `json:"sample,omitempty"`
}
type ReportResponse struct {
	Settings    Settings `json:"settings"`
	ReportToken string   `json:"reportToken,omitempty"`
	Accepted    bool     `json:"accepted"`
}

type CheckTarget struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Kind            string `json:"kind"`
	URL             string `json:"url"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	TimeoutMS       int    `json:"timeoutMs"`
	IntervalSeconds int    `json:"intervalSeconds"`
}

func (c CheckTarget) Validate() error {
	if !ValidID(c.ID) || len(c.Name) > 128 || c.TimeoutMS < 100 || c.TimeoutMS > 10000 || c.IntervalSeconds < 10 || c.IntervalSeconds > 3600 {
		return errors.New("invalid network check settings")
	}
	switch c.Kind {
	case "icmp", "tcp":
		if c.Host == "" || len(c.Host) > 253 || strings.ContainsAny(c.Host, " /\x00\n\r\t:@") {
			if net.ParseIP(c.Host) == nil {
				return errors.New("invalid check host")
			}
		}
		if c.Kind == "tcp" && (c.Port < 1 || c.Port > 65535) {
			return errors.New("invalid TCP port")
		}
	case "http":
		u, e := url.Parse(c.URL)
		if e != nil || len(c.URL) > 2048 || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Fragment != "" {
			return errors.New("invalid HTTP check URL")
		}
	default:
		return errors.New("unsupported network check")
	}
	return nil
}

type CheckResult struct {
	TargetID    string    `json:"targetID"`
	Kind        string    `json:"kind"`
	Success     bool      `json:"success"`
	Unavailable bool      `json:"unavailable"`
	LatencyMS   float64   `json:"latencyMs"`
	Error       string    `json:"error,omitempty"`
	CheckedAt   time.Time `json:"checkedAt"`
}
