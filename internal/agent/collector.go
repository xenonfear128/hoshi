package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	"remoter/internal/agentproto"
)

type Collector struct {
	AgentID, Version, BootID, SessionID string
	mu                                  sync.Mutex
	seq                                 uint64
	previous                            []cpu.TimesStat
}

func newID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func NewCollector(version string) *Collector {
	boot, _ := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if len(boot) == 0 {
		v, _ := host.BootTime()
		boot = []byte(fmt.Sprint(v))
	}
	return &Collector{AgentID: newID(), Version: version, BootID: strings.TrimSpace(string(boot)), SessionID: newID()}
}
func cpuUse(prev, next cpu.TimesStat) (float64, bool) {
	total := func(t cpu.TimesStat) float64 {
		return t.User + t.Nice + t.System + t.Idle + t.Iowait + t.Irq + t.Softirq + t.Steal
	}
	dt := total(next) - total(prev)
	idle := (next.Idle + next.Iowait) - (prev.Idle + prev.Iowait)
	if dt <= 0 || idle < 0 || idle > dt {
		return 0, false
	}
	return 100 * (1 - idle/dt), true
}
func (c *Collector) Sample(ctx context.Context, cfg agentproto.Settings) agentproto.Sample {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seq++
	s := agentproto.Sample{Protocol: agentproto.ProtocolVersion, AgentID: c.AgentID, Version: c.Version, BootID: c.BootID, SessionID: c.SessionID, Sequence: c.seq, Arch: runtime.GOARCH, OS: runtime.GOOS, Network: []agentproto.NetworkSample{}, Mounts: []agentproto.MountSample{}, Disks: []agentproto.DiskIOSample{}, GPUs: []agentproto.GPU{}, PerCoreCPU: []float64{}, Checks: []agentproto.CheckResult{}, Capabilities: agentproto.Capabilities{}}
	state := func(key string, e error) {
		s.Capabilities[key] = "available"
		if e != nil {
			s.Capabilities[key] = "unavailable"
			if os.IsPermission(e) {
				s.Capabilities[key] = "permission"
			}
		}
	}
	if info, e := host.InfoWithContext(ctx); e == nil {
		s.Hostname = info.Hostname
		s.Uptime = info.Uptime
		s.Kernel = info.KernelVersion
		s.OS = info.Platform + " " + info.PlatformVersion
	}
	times, e := cpu.TimesWithContext(ctx, true)
	state("cpu", e)
	state("perCoreCPU", e)
	s.Cores = len(times)
	if e == nil {
		if len(c.previous) == len(times) && len(times) > 0 {
			sum := 0.0
			valid := true
			for i, t := range times {
				v, ok := cpuUse(c.previous[i], t)
				if !ok {
					valid = false
					break
				}
				sum += v
				s.PerCoreCPU = append(s.PerCoreCPU, v)
			}
			if valid {
				v := sum / float64(len(times))
				s.CPU = &v
			} else {
				s.PerCoreCPU = nil
				s.Capabilities["cpu"] = "warming"
				s.Capabilities["perCoreCPU"] = "warming"
			}
		} else {
			s.Capabilities["cpu"] = "warming"
			s.Capabilities["perCoreCPU"] = "warming"
		}
		c.previous = times
	}
	if v, e := mem.VirtualMemoryWithContext(ctx); e == nil {
		s.MemoryTotal = v.Total
		s.MemoryUsed = v.Total - v.Available
		state("memory", nil)
	} else {
		state("memory", e)
	}
	if v, e := mem.SwapMemoryWithContext(ctx); e == nil {
		s.SwapTotal = v.Total
		s.SwapUsed = v.Used
		state("swap", nil)
	} else {
		state("swap", e)
	}
	if v, e := load.AvgWithContext(ctx); e == nil {
		s.Load = &[3]float64{v.Load1, v.Load5, v.Load15}
		state("load", nil)
	} else {
		state("load", e)
	}
	if p, e := process.PidsWithContext(ctx); e == nil {
		n := len(p)
		s.Processes = &n
		state("processes", nil)
	} else {
		state("processes", e)
	}
	s.TCP = socketCount("tcp", "tcp6")
	s.UDP = socketCount("udp", "udp6")
	s.Capabilities["connections"] = "available"
	if s.TCP == nil || s.UDP == nil {
		s.Capabilities["connections"] = "unavailable"
	}
	interfaces, _ := net.Interfaces()
	index := map[string]int{}
	for _, i := range interfaces {
		index[i.Name] = i.Index
	}
	if nets, e := gnet.IOCountersWithContext(ctx, true); e == nil {
		defaults := defaultInterfaces()
		for _, n := range nets {
			if n.Name == "lo" || !included(n.Name, cfg.Interfaces, cfg.ExcludeInterfaces) {
				continue
			}
			isDefault := defaults[n.Name]
			s.Network = append(s.Network, agentproto.NetworkSample{Name: n.Name, Index: index[n.Name], Default: isDefault, RxBytes: n.BytesRecv, TxBytes: n.BytesSent, RxPackets: n.PacketsRecv, TxPackets: n.PacketsSent, RxErrors: n.Errin, TxErrors: n.Errout, RxDrops: n.Dropin, TxDrops: n.Dropout})
			if len(s.Network) >= 128 {
				break
			}
		}
		state("network", nil)
		state("netErrors", nil)
	} else {
		state("network", e)
		state("netErrors", e)
	}
	if parts, e := disk.PartitionsWithContext(ctx, true); e == nil {
		// Prefer the shortest mount of a device, avoiding bind-mount duplicates.
		sort.Slice(parts, func(i, j int) bool { return len(parts[i].Mountpoint) < len(parts[j].Mountpoint) })
		seen := map[string]bool{}
		for _, p := range parts {
			if !included(p.Mountpoint, cfg.Mounts, cfg.ExcludeMounts) || pseudoFS(p.Fstype) || (p.Fstype == "overlay" && p.Mountpoint != "/") {
				continue
			}
			if seen[p.Device] && len(cfg.Mounts) == 0 {
				continue
			}
			if u, e := disk.UsageWithContext(ctx, p.Mountpoint); e == nil {
				seen[p.Device] = true
				s.Mounts = append(s.Mounts, agentproto.MountSample{Mount: p.Mountpoint, Device: p.Device, Total: u.Total, Used: u.Used, Free: u.Free})
			}
			if len(s.Mounts) >= 128 {
				break
			}
		}
		state("mounts", nil)
	} else {
		state("mounts", e)
	}
	if counters, e := disk.IOCountersWithContext(ctx); e == nil {
		for name, d := range counters {
			if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") {
				continue
			}
			s.Disks = append(s.Disks, agentproto.DiskIOSample{Name: name, ReadBytes: d.ReadBytes, WriteBytes: d.WriteBytes, ReadOps: d.ReadCount, WriteOps: d.WriteCount})
			if len(s.Disks) >= 256 {
				break
			}
		}
		state("diskIO", nil)
	} else {
		state("diskIO", e)
	}
	if cfg.GPU {
		s.GPUs, s.Capabilities["gpu"] = collectGPU(ctx)
	} else {
		s.Capabilities["gpu"] = "disabled"
	}
	sort.Slice(s.Network, func(i, j int) bool { return s.Network[i].Name < s.Network[j].Name })
	sort.Slice(s.Disks, func(i, j int) bool { return s.Disks[i].Name < s.Disks[j].Name })
	s.SampledAt = time.Now().UTC()
	return s
}
func included(name string, include, exclude []string) bool {
	return (len(include) == 0 || slices.Contains(include, name)) && !slices.Contains(exclude, name)
}
func pseudoFS(fs string) bool {
	return slices.Contains([]string{"proc", "sysfs", "tmpfs", "devtmpfs", "devpts", "cgroup", "cgroup2", "securityfs", "debugfs", "tracefs", "pstore", "mqueue", "hugetlbfs", "configfs", "fusectl", "binfmt_misc", "autofs", "nsfs", "ramfs", "bpf"}, fs)
}
func socketCount(kinds ...string) *int {
	total := 0
	read := false
	for _, kind := range kinds {
		b, e := os.ReadFile("/proc/net/" + kind)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return nil
		}
		read = true
		for i, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			if i > 0 && strings.TrimSpace(line) != "" {
				total++
			}
		}
	}
	if !read {
		return nil
	}
	return &total
}
func defaultInterfaces() map[string]bool {
	out := map[string]bool{}
	if b, e := os.ReadFile("/proc/net/route"); e == nil {
		for _, line := range strings.Split(string(b), "\n") {
			f := strings.Fields(line)
			if len(f) > 7 && f[1] == "00000000" && f[7] == "00000000" {
				out[f[0]] = true
			}
		}
	}
	if b, e := os.ReadFile("/proc/net/ipv6_route"); e == nil {
		for _, line := range strings.Split(string(b), "\n") {
			f := strings.Fields(line)
			if len(f) >= 10 && f[0] == strings.Repeat("0", 32) && f[1] == "00" && f[len(f)-1] != "lo" {
				out[f[len(f)-1]] = true
			}
		}
	}
	return out
}
