package agentproto

import (
	"testing"
	"time"
)

func TestSettingsValidation(t *testing.T) {
	s := DefaultSettings()
	if e := s.Validate(); e != nil {
		t.Fatal(e)
	}
	s.IntervalSeconds = 2
	if s.Validate() == nil {
		t.Fatal("accepted unsupported interval")
	}
	s = DefaultSettings()
	s.Checks = []CheckTarget{{ID: "api", Kind: "http", URL: "https://example.com/health", TimeoutMS: 1000, IntervalSeconds: 30}}
	if e := s.Validate(); e != nil {
		t.Fatal(e)
	}
	s.Checks[0].URL = "http://user:pass@example.com"
	if s.Validate() == nil {
		t.Fatal("accepted credential-bearing target")
	}
}
func TestSampleRejectsUnsafeDimensions(t *testing.T) {
	now := time.Now()
	cpu := 50.0
	s := Sample{Protocol: ProtocolVersion, AgentID: "agent", BootID: "boot", SessionID: "session", Sequence: 1, SampledAt: now, CPU: &cpu, Capabilities: Capabilities{"cpu": "available"}}
	if e := s.Validate(now); e != nil {
		t.Fatal(e)
	}
	s.Network = []NetworkSample{{Name: "eth0\ncommand"}}
	if s.Validate(now) == nil {
		t.Fatal("accepted control character in interface label")
	}
	s = samp(now)
	s.SampledAt = now.Add(-2 * time.Hour)
	if s.Validate(now) == nil {
		t.Fatal("accepted stale sample")
	}
}
func samp(now time.Time) Sample {
	cpu := 1.0
	return Sample{Protocol: ProtocolVersion, AgentID: "agent", BootID: "boot", SessionID: "session", Sequence: 1, SampledAt: now, CPU: &cpu}
}
