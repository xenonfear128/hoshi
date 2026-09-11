package app

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"remoter/internal/agentproto"
)

type Stat struct {
	Count   int64   `json:"count"`
	Sum     float64 `json:"sum"`
	Min     float64 `json:"min"`
	Max     float64 `json:"max"`
	Average float64 `json:"average"`
}

func (s *Stat) Add(v float64) {
	if s.Count == 0 || v < s.Min {
		s.Min = v
	}
	if s.Count == 0 || v > s.Max {
		s.Max = v
	}
	s.Sum += v
	s.Count++
	s.Average = s.Sum / float64(s.Count)
}
func (s *Stat) Merge(v Stat) {
	if v.Count == 0 {
		return
	}
	if s.Count == 0 || v.Min < s.Min {
		s.Min = v.Min
	}
	if s.Count == 0 || v.Max > s.Max {
		s.Max = v.Max
	}
	s.Sum += v.Sum
	s.Count += v.Count
	s.Average = s.Sum / float64(s.Count)
}

type Traffic struct {
	Rx     uint64  `json:"rx"`
	Tx     uint64  `json:"tx"`
	RxPeak float64 `json:"rxPeak"`
	TxPeak float64 `json:"txPeak"`
}
type CheckTotals struct {
	Success     int64 `json:"success"`
	Failure     int64 `json:"failure"`
	Unavailable int64 `json:"unavailable"`
	Latency     Stat  `json:"latency"`
}
type MonitorLatest struct {
	cacheBytes      int
	IntervalSeconds int                `json:"intervalSeconds"`
	Sample          *agentproto.Sample `json:"sample"`
	ReceivedAt      time.Time          `json:"receivedAt"`
	Values          map[string]float64 `json:"values"`
	Traffic         map[string]Traffic `json:"traffic"`
	CounterReset    bool               `json:"counterReset"`
	Gap             bool               `json:"gap"`
}
type Rollup struct {
	Time    time.Time              `json:"time"`
	Step    int                    `json:"step"`
	Count   int64                  `json:"count"`
	Metrics map[string]Stat        `json:"metrics"`
	Traffic map[string]Traffic     `json:"traffic"`
	Checks  map[string]CheckTotals `json:"checks"`
	Gap     bool                   `json:"gap"`
}

func newRollup(t time.Time, step int) Rollup {
	return Rollup{Time: t, Step: step, Metrics: map[string]Stat{}, Traffic: map[string]Traffic{}, Checks: map[string]CheckTotals{}}
}
func addTraffic(dst map[string]Traffic, src map[string]Traffic) {
	for name, t := range src {
		d := dst[name]
		d.Rx += t.Rx
		d.Tx += t.Tx
		d.RxPeak = math.Max(d.RxPeak, t.RxPeak)
		d.TxPeak = math.Max(d.TxPeak, t.TxPeak)
		dst[name] = d
	}
}
func selectedInterface(n agentproto.NetworkSample, cfg agentproto.Settings) bool {
	if slices.Contains(cfg.ExcludeInterfaces, n.Name) {
		return false
	}
	if len(cfg.Interfaces) > 0 {
		return slices.Contains(cfg.Interfaces, n.Name)
	}
	return n.Default
}
func deriveMetrics(m agentproto.Sample, previous MonitorLatest, cfg agentproto.Settings) MonitorLatest {
	latest := MonitorLatest{IntervalSeconds: cfg.IntervalSeconds, Sample: &m, Values: map[string]float64{}, Traffic: map[string]Traffic{}}
	v := latest.Values
	if m.CPU != nil {
		v["cpu"] = *m.CPU
	}
	for i, n := range m.PerCoreCPU {
		v[fmt.Sprintf("core:%d", i)] = n
	}
	if m.Capabilities["memory"] == "available" {
		v["memoryTotal"] = float64(m.MemoryTotal)
		v["memoryUsed"] = float64(m.MemoryUsed)
		if m.MemoryTotal > 0 {
			v["memory"] = 100 * float64(m.MemoryUsed) / float64(m.MemoryTotal)
		}
	}
	if m.Capabilities["swap"] == "available" {
		v["swapTotal"] = float64(m.SwapTotal)
		v["swapUsed"] = float64(m.SwapUsed)
	}
	if m.Load != nil {
		v["load1"] = m.Load[0]
		v["load5"] = m.Load[1]
		v["load15"] = m.Load[2]
	}
	v["uptime"] = float64(m.Uptime)
	for key, n := range map[string]*int{"processes": m.Processes, "tcp": m.TCP, "udp": m.UDP} {
		if n != nil {
			v[key] = float64(*n)
		}
	}
	for _, d := range m.Mounts {
		v["mount:"+d.Mount+":total"] = float64(d.Total)
		v["mount:"+d.Mount+":used"] = float64(d.Used)
		v["mount:"+d.Mount+":free"] = float64(d.Free)
		if d.Total > 0 {
			v["mount:"+d.Mount+":percent"] = float64(d.Used) * 100 / float64(d.Total)
		}
	}
	for _, g := range m.GPUs {
		prefix := fmt.Sprintf("gpu:%d:", g.Index)
		if g.Utilization != nil {
			v[prefix+"usage"] = *g.Utilization
		}
		if g.Temperature != nil {
			v[prefix+"temperature"] = *g.Temperature
		}
		if g.MemoryTotal != nil {
			v[prefix+"memoryTotal"] = float64(*g.MemoryTotal)
		}
		if g.MemoryUsed != nil {
			v[prefix+"memoryUsed"] = float64(*g.MemoryUsed)
		}
	}
	p := previous.Sample
	if p == nil {
		return latest
	}
	dt := m.SampledAt.Sub(p.SampledAt).Seconds()
	if dt <= 0 {
		return latest
	}
	latest.Gap = dt > float64(max(10, cfg.IntervalSeconds*3))
	if p.BootID != m.BootID {
		latest.CounterReset = true
		return latest
	}
	oldNet := map[string]agentproto.NetworkSample{}
	for _, n := range p.Network {
		oldNet[n.Name] = n
	}
	rateOK := !latest.Gap
	sumRx, sumTx := 0.0, 0.0
	selected := 0
	for _, n := range m.Network {
		old, ok := oldNet[n.Name]
		if !ok || old.Index != n.Index || n.RxBytes < old.RxBytes || n.TxBytes < old.TxBytes {
			latest.CounterReset = true
			continue
		}
		rx := n.RxBytes - old.RxBytes
		tx := n.TxBytes - old.TxBytes
		t := Traffic{Rx: rx, Tx: tx}
		if rateOK {
			t.RxPeak = float64(rx) / dt
			t.TxPeak = float64(tx) / dt
			prefix := "net:" + n.Name + ":"
			v[prefix+"rx"] = t.RxPeak
			v[prefix+"tx"] = t.TxPeak
			for key, counts := range map[string][2]uint64{"rxErrors": {n.RxErrors, old.RxErrors}, "txErrors": {n.TxErrors, old.TxErrors}, "rxDrops": {n.RxDrops, old.RxDrops}, "txDrops": {n.TxDrops, old.TxDrops}} {
				if counts[0] >= counts[1] {
					v[prefix+key] = float64(counts[0]-counts[1]) / dt
				}
			}
			if selectedInterface(n, cfg) {
				sumRx += t.RxPeak
				sumTx += t.TxPeak
				selected++
			}
		}
		latest.Traffic[n.Name] = t
	}
	if selected > 0 {
		v["rx"] = sumRx
		v["tx"] = sumTx
	}
	if rateOK {
		oldDisks := map[string]agentproto.DiskIOSample{}
		for _, d := range p.Disks {
			oldDisks[d.Name] = d
		}
		for _, d := range m.Disks {
			old, ok := oldDisks[d.Name]
			if !ok {
				continue
			}
			for key, counters := range map[string][2]uint64{"read": {d.ReadBytes, old.ReadBytes}, "write": {d.WriteBytes, old.WriteBytes}, "readIOPS": {d.ReadOps, old.ReadOps}, "writeIOPS": {d.WriteOps, old.WriteOps}} {
				if counters[0] >= counters[1] {
					v["disk:"+d.Name+":"+key] = float64(counters[0]-counters[1]) / dt
				}
			}
		}
	}
	return latest
}
func (s *Server) persistMonitor(ctx context.Context, tx pgx.Tx, b agentBinding, m, previous MonitorLatest, cfg agentproto.Settings) error {
	sample := m.Sample
	for _, step := range []int{10, 60, 3600} {
		bucket := sample.SampledAt.Truncate(time.Duration(step) * time.Second)
		r := newRollup(bucket, step)
		var encrypted string
		e := tx.QueryRow(ctx, "SELECT data FROM metric_rollups WHERE host_id=$1 AND step=$2 AND bucket=$3", b.HostID, step, bucket).Scan(&encrypted)
		if e != nil && !isMissing(e) {
			return e
		}
		if e == nil {
			if e = s.openMonitor(b.UserID, b.HostID, monitorAAD(step, bucket), encrypted, &r); e != nil {
				return e
			}
		}
		r.Count++
		r.Gap = r.Gap || m.Gap || m.CounterReset
		for key, value := range m.Values {
			stat := r.Metrics[key]
			stat.Add(value)
			r.Metrics[key] = stat
		}
		addTraffic(r.Traffic, m.Traffic)
		for _, c := range sample.Checks {
			if !slices.ContainsFunc(cfg.Checks, func(t agentproto.CheckTarget) bool { return t.ID == c.TargetID && t.Kind == c.Kind }) {
				continue
			}
			total := r.Checks[c.TargetID]
			if c.Unavailable {
				total.Unavailable++
			} else if c.Success {
				total.Success++
				total.Latency.Add(c.LatencyMS)
			} else {
				total.Failure++
			}
			r.Checks[c.TargetID] = total
		}
		if len(r.Metrics) > 8192 || len(r.Traffic) > 512 || len(r.Checks) > 256 {
			return errors.New("monitoring dimension limit reached")
		}
		encrypted, e = s.sealMonitor(b.UserID, b.HostID, monitorAAD(step, bucket), r)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `INSERT INTO metric_rollups(host_id,step,bucket,data) VALUES($1,$2,$3,$4) ON CONFLICT(host_id,step,bucket) DO UPDATE SET data=$4`, b.HostID, step, bucket, encrypted)
		if e != nil {
			return e
		}
	}
	if previous.Sample != nil && sample.SampledAt.After(previous.Sample.SampledAt) {
		kind := ""
		if sample.BootID != previous.Sample.BootID {
			kind = "host_restarted"
		} else if sample.SessionID != previous.Sample.SessionID {
			kind = "agent_restarted"
		} else if m.CounterReset {
			kind = "counter_reset"
		} else if m.Gap {
			kind = "collection_gap"
		}
		if kind != "" {
			if _, e := s.monitorEvent(ctx, tx, b, kind, "info", map[string]any{"sampledAt": sample.SampledAt}); e != nil {
				return e
			}
		}
		if e := s.persistTraffic(ctx, tx, b, m, previous.Sample.SampledAt, cfg); e != nil {
			return e
		}
	}
	return nil
}
func billingPeriod(t time.Time, kind string, cfg agentproto.Settings) (time.Time, time.Time) {
	loc, _ := time.LoadLocation(cfg.Timezone)
	if loc == nil {
		loc = time.UTC
	}
	t = t.In(loc)
	if kind == "day" {
		start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 0, 1)
	}
	start := time.Date(t.Year(), t.Month(), cfg.BillingDay, 0, 0, 0, 0, loc)
	if t.Before(start) {
		start = start.AddDate(0, -1, 0)
	}
	return start, start.AddDate(0, 1, 0)
}
func trafficAAD(kind string, t time.Time) string { return fmt.Sprintf("traffic:%s:%d", kind, t.Unix()) }
func (s *Server) persistTraffic(ctx context.Context, tx pgx.Tx, b agentBinding, m MonitorLatest, from time.Time, cfg agentproto.Settings) error {
	if len(m.Traffic) == 0 {
		return nil
	}
	to := m.Sample.SampledAt
	duration := to.Sub(from).Seconds()
	if duration <= 0 {
		return nil
	}
	// A gap crossing a calendar boundary has no exact per-period timestamps.
	// Allocate the delta by elapsed time; history retains the collection gap.
	for _, kind := range []string{"day", "month"} {
		remaining := map[string]Traffic{}
		addTraffic(remaining, m.Traffic)
		cursor := from
		for i := 0; cursor.Before(to) && i < 366; i++ {
			start, end := billingPeriod(cursor, kind, cfg)
			until := end
			if until.After(to) {
				until = to
			}
			portion := map[string]Traffic{}
			for name, t := range m.Traffic {
				p := t
				if until.Before(to) {
					fraction := until.Sub(cursor).Seconds() / duration
					p.Rx = uint64(float64(t.Rx) * fraction)
					p.Tx = uint64(float64(t.Tx) * fraction)
				} else {
					p.Rx = remaining[name].Rx
					p.Tx = remaining[name].Tx
				}
				left := remaining[name]
				left.Rx -= p.Rx
				left.Tx -= p.Tx
				remaining[name] = left
				portion[name] = p
			}
			totals := map[string]Traffic{}
			var raw string
			e := tx.QueryRow(ctx, "SELECT data FROM monitor_traffic WHERE host_id=$1 AND period=$2 AND start_at=$3", b.HostID, kind, start).Scan(&raw)
			if e != nil && !isMissing(e) {
				return e
			}
			if e == nil {
				if e = s.openMonitor(b.UserID, b.HostID, trafficAAD(kind, start), raw, &totals); e != nil {
					return e
				}
			}
			addTraffic(totals, portion)
			if len(totals) > 512 {
				return errors.New("monitoring dimension limit reached")
			}
			raw, e = s.sealMonitor(b.UserID, b.HostID, trafficAAD(kind, start), totals)
			if e != nil {
				return e
			}
			_, e = tx.Exec(ctx, `INSERT INTO monitor_traffic(host_id,period,start_at,data) VALUES($1,$2,$3,$4) ON CONFLICT(host_id,period,start_at) DO UPDATE SET data=$4`, b.HostID, kind, start, raw)
			if e != nil {
				return e
			}
			cursor = until
		}
	}
	return nil
}
func (s *Server) cacheAgent(host string, m MonitorLatest) {
	// Account for maps and strings as well as the encoded sample. Raw history is
	// best effort; persistent rollups do not depend on this memory window.
	m.cacheBytes = 2 * len(jsonBytes(m))
	s.mu.Lock()
	defer s.mu.Unlock()
	ring := s.agentCache[host]
	ring = append(ring, m)
	bytes := 0
	for _, sample := range ring {
		bytes += sample.cacheBytes
	}
	start := 0
	for start < len(ring)-1 && (ring[start].Sample.SampledAt.Before(time.Now().Add(-10*time.Minute)) || len(ring)-start > 600 || bytes > 8<<20) {
		bytes -= ring[start].cacheBytes
		start++
	}
	s.agentCache[host] = slices.Clone(ring[start:])
	// Bound the whole process, including idle hosts. Evict the oldest host's
	// raw window first; it can still be queried through persistent history.
	for {
		total := 0
		oldest := ""
		var oldestAt time.Time
		for id, samples := range s.agentCache {
			for _, sample := range samples {
				total += sample.cacheBytes
			}
			if id != host && len(samples) > 0 && (oldest == "" || samples[len(samples)-1].ReceivedAt.Before(oldestAt)) {
				oldest, oldestAt = id, samples[len(samples)-1].ReceivedAt
			}
		}
		if total <= 128<<20 || oldest == "" {
			break
		}
		delete(s.agentCache, oldest)
	}
}
func (s *Server) clearAgentCache(host string) { s.mu.Lock(); delete(s.agentCache, host); s.mu.Unlock() }
func (s *Server) monitorLatest(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	b, e := scanBinding(s.db.QueryRow(r.Context(), "SELECT "+bindingColumns+" FROM agent_bindings WHERE host_id=$1 AND user_id=$2", id, uid(r)))
	if isMissing(e) {
		respond(w, 200, map[string]any{"sample": nil, "status": "disabled"})
		return
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	cfg, e := s.agentSettings(b)
	if e != nil {
		s.dbError(w, e)
		return
	}
	var latest MonitorLatest
	if e = s.openMonitor(b.UserID, id, "agent-latest", b.Latest, &latest); e != nil {
		s.dbError(w, e)
		return
	}
	periods := map[string]any{}
	for _, kind := range []string{"day", "month"} {
		start, end := billingPeriod(time.Now(), kind, cfg)
		totals := map[string]Traffic{}
		var raw string
		e = s.db.QueryRow(r.Context(), "SELECT data FROM monitor_traffic WHERE host_id=$1 AND period=$2 AND start_at=$3", id, kind, start).Scan(&raw)
		if e != nil && !isMissing(e) {
			s.dbError(w, e)
			return
		}
		if e == nil {
			if e = s.openMonitor(b.UserID, id, trafficAAD(kind, start), raw, &totals); e != nil {
				s.dbError(w, e)
				return
			}
		}
		periods[kind] = map[string]any{"start": start, "end": end, "interfaces": totals}
	}
	respond(w, 200, map[string]any{"sample": latest.Sample, "values": latest.Values, "receivedAt": latest.ReceivedAt, "status": agentStatus(b, cfg, time.Now()), "periods": periods, "settings": cfg, "gap": latest.Gap, "source": "agent"})
}
func (s *Server) monitorHistory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	now := time.Now()
	from := now.Add(-time.Hour)
	to := now
	var e error
	if raw := r.URL.Query().Get("from"); raw != "" {
		from, e = time.Parse(time.RFC3339, raw)
		if e != nil {
			fail(w, 400, "invalid history time range")
			return
		}
	}
	if raw := r.URL.Query().Get("to"); raw != "" {
		to, e = time.Parse(time.RFC3339, raw)
		if e != nil {
			fail(w, 400, "invalid history time range")
			return
		}
	}
	if from.Before(now.Add(-180*24*time.Hour)) || to.After(now.Add(time.Minute)) || !from.Before(to) {
		fail(w, 400, "history range must be within 180 days")
		return
	}
	step := 10
	if from.Before(now.Add(-24*time.Hour)) || to.Sub(from) > 6*time.Hour {
		step = 60
	}
	if from.Before(now.Add(-30*24*time.Hour)) || to.Sub(from) > 7*24*time.Hour {
		step = 3600
	}
	rows, e := s.db.Query(r.Context(), "SELECT bucket,data FROM metric_rollups WHERE host_id=$1 AND step=$2 AND bucket>=$3 AND bucket<=$4 ORDER BY bucket", id, step, from.Truncate(time.Duration(step)*time.Second), to)
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	points := []Rollup{}
	for rows.Next() {
		var t time.Time
		var raw string
		if e = rows.Scan(&t, &raw); e != nil {
			break
		}
		var point Rollup
		if e = s.openMonitor(uid(r), id, monitorAAD(step, t), raw, &point); e != nil {
			break
		}
		points = append(points, point)
	}
	if e == nil {
		e = rows.Err()
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	// Emit explicit empty buckets. Clients must never connect curves across them.
	factor := max(1, int(math.Ceil(to.Sub(from).Seconds()/float64(step)/1500)))
	displayStep := step * factor
	merged := map[int64]Rollup{}
	for _, p := range points {
		t := p.Time.Truncate(time.Duration(displayStep) * time.Second)
		key := t.Unix()
		out, ok := merged[key]
		if !ok {
			out = newRollup(t, displayStep)
		}
		out.Count += p.Count
		out.Gap = out.Gap || p.Gap
		for k, v := range p.Metrics {
			stat := out.Metrics[k]
			stat.Merge(v)
			out.Metrics[k] = stat
		}
		addTraffic(out.Traffic, p.Traffic)
		for k, c := range p.Checks {
			d := out.Checks[k]
			d.Success += c.Success
			d.Failure += c.Failure
			d.Unavailable += c.Unavailable
			d.Latency.Merge(c.Latency)
			out.Checks[k] = d
		}
		merged[key] = out
	}
	result := []Rollup{}
	for t := from.Truncate(time.Duration(displayStep) * time.Second); !t.After(to); t = t.Add(time.Duration(displayStep) * time.Second) {
		point, ok := merged[t.Unix()]
		if !ok {
			point = newRollup(t, displayStep)
			point.Gap = true
		}
		result = append(result, point)
	}
	respond(w, 200, map[string]any{"step": displayStep, "points": result})
}
func (s *Server) monitorRaw(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, _, e := s.loadHost(r, id); e != nil {
		fail(w, 404, "host not found")
		return
	}
	s.mu.Lock()
	out := slices.Clone(s.agentCache[id])
	s.mu.Unlock()
	respond(w, 200, out)
}
func (s *Server) monitorSummary(w http.ResponseWriter, r *http.Request) {
	rows, e := s.db.Query(r.Context(), "SELECT "+bindingColumns+" FROM agent_bindings WHERE user_id=$1", uid(r))
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer rows.Close()
	out := map[string]any{}
	for rows.Next() {
		b, err := scanBinding(rows)
		if err != nil {
			e = err
			break
		}
		cfg, err := s.agentSettings(b)
		if err != nil {
			e = err
			break
		}
		var m MonitorLatest
		if e = s.openMonitor(b.UserID, b.HostID, "agent-latest", b.Latest, &m); e != nil {
			break
		}
		values := map[string]float64{}
		for _, k := range []string{"cpu", "memory", "rx", "tx"} {
			if v, ok := m.Values[k]; ok {
				values[k] = v
			}
		}
		out[b.HostID] = map[string]any{"status": agentStatus(b, cfg, time.Now()), "values": values, "lastSeen": b.LastSeen, "lastCurrent": b.LastCurrent}
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
