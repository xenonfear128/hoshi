package app

import (
	"remoter/internal/agentproto"
	"testing"
	"time"
)

func TestDeriveMetricsDoesNotBridgeGapsOrCounterResets(t *testing.T) {
	now := time.Now().UTC()
	cpu := 20.0
	old := MonitorLatest{Sample: &agentproto.Sample{BootID: "boot", SampledAt: now.Add(-3 * time.Second), Network: []agentproto.NetworkSample{{Name: "eth0", Index: 2, RxBytes: 100, TxBytes: 200}}}}
	current := agentproto.Sample{BootID: "boot", SampledAt: now, Network: []agentproto.NetworkSample{{Name: "eth0", Index: 2, RxBytes: 400, TxBytes: 500}}, CPU: &cpu}
	out := deriveMetrics(current, old, agentproto.DefaultSettings())
	if out.Gap {
		t.Fatal("three-second sample was treated as a gap")
	}
	if out.Values["net:eth0:rx"] != 100 {
		t.Fatalf("unexpected receive rate: %v", out.Values["net:eth0:rx"])
	}
	current.SampledAt = now.Add(30 * time.Second)
	out = deriveMetrics(current, old, agentproto.DefaultSettings())
	if !out.Gap {
		t.Fatal("gap was hidden")
	}
	if _, ok := out.Values["rx"]; ok {
		t.Fatal("gap produced a continuous aggregate")
	}
	current.SampledAt = now
	current.BootID = "new-boot"
	out = deriveMetrics(current, old, agentproto.DefaultSettings())
	if !out.CounterReset {
		t.Fatal("reboot was not marked")
	}
}

func TestCounterResetBillingAndWeightedStats(t *testing.T) {
	cfg := agentproto.DefaultSettings()
	cfg.BillingDay = 15
	cfg.Timezone = "America/New_York"
	before := time.Date(2026, 3, 8, 12, 0, 0, 0, time.UTC)
	start, end := billingPeriod(before, "day", cfg)
	if end.Sub(start) != 23*time.Hour {
		t.Fatal("DST billing used fixed 24 hours")
	}
	start, _ = billingPeriod(before, "month", cfg)
	if start.Day() != 15 || start.Month() != time.February {
		t.Fatal("wrong billing cycle")
	}
	stat := Stat{}
	stat.Add(20)
	stat.Add(40)
	other := Stat{}
	other.Add(100)
	stat.Merge(other)
	if stat.Count != 3 || stat.Average != 160.0/3 || stat.Max != 100 {
		t.Fatal("weighted average/peak lost")
	}
	now := time.Now()
	old := MonitorLatest{Sample: &agentproto.Sample{BootID: "b", SampledAt: now.Add(-3 * time.Second), Network: []agentproto.NetworkSample{{Name: "eth0", Index: 1, RxBytes: 1000, TxBytes: 1000}}}}
	current := agentproto.Sample{BootID: "b", SampledAt: now, Network: []agentproto.NetworkSample{{Name: "eth0", Index: 2, RxBytes: 9000, TxBytes: 9000}}}
	v := deriveMetrics(current, old, cfg)
	if !v.CounterReset || len(v.Traffic) != 0 {
		t.Fatal("recreated NIC generated traffic spike")
	}
}
