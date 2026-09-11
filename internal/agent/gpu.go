package agent

import (
	"bytes"
	"context"
	"encoding/csv"
	"os"
	"os/exec"
	"path/filepath"
	"remoter/internal/agentproto"
	"strconv"
	"strings"
	"time"
)

func gpuNumber(raw string) *float64 {
	v, e := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if e != nil || v < 0 {
		return nil
	}
	return &v
}
func gpuBytes(raw string) *uint64 {
	v := gpuNumber(raw)
	if v == nil {
		return nil
	}
	n := uint64(*v * 1024 * 1024)
	return &n
}
func parseNVIDIA(b []byte) ([]agentproto.GPU, error) {
	rows, e := csv.NewReader(bytes.NewReader(b)).ReadAll()
	if e != nil {
		return nil, e
	}
	out := []agentproto.GPU{}
	for _, r := range rows {
		if len(r) != 6 {
			continue
		}
		out = append(out, agentproto.GPU{Index: len(out), Name: strings.TrimSpace(r[0]), Utilization: gpuNumber(r[1]), MemoryTotal: gpuBytes(r[2]), MemoryUsed: gpuBytes(r[3]), Temperature: gpuNumber(r[4])})
		if len(out) >= 32 {
			break
		}
	}
	return out, nil
}
func collectGPU(ctx context.Context) ([]agentproto.GPU, string) {
	if tool, e := exec.LookPath("nvidia-smi"); e == nil {
		limit, cancel := context.WithTimeout(ctx, 2*time.Second)
		defer cancel()
		cmd := exec.CommandContext(limit, tool, "--query-gpu=name,utilization.gpu,memory.total,memory.used,temperature.gpu,index", "--format=csv,noheader,nounits")
		out := &boundedOutput{limit: 64 << 10}
		cmd.Stdout = out
		if e = cmd.Run(); e != nil {
			if os.IsPermission(e) {
				return nil, "permission"
			}
			return nil, "unavailable"
		}
		if g, e := parseNVIDIA(out.Bytes()); e == nil && len(g) > 0 {
			return g, "available"
		}
		return nil, "unavailable"
	}
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]*/device")
	out := []agentproto.GPU{}
	hasDevice := false
	for _, card := range cards {
		if strings.Contains(filepath.Base(filepath.Dir(card)), "-") {
			continue
		}
		hasDevice = true
		busy, e := os.ReadFile(filepath.Join(card, "gpu_busy_percent"))
		if e != nil {
			continue
		}
		g := agentproto.GPU{Index: len(out), Name: filepath.Base(filepath.Dir(card)), Utilization: gpuNumber(string(busy))}
		readBytes := func(name string) *uint64 {
			b, e := os.ReadFile(filepath.Join(card, name))
			if e != nil {
				return nil
			}
			v, e := strconv.ParseUint(strings.TrimSpace(string(b)), 10, 64)
			if e != nil {
				return nil
			}
			return &v
		}
		g.MemoryTotal = readBytes("mem_info_vram_total")
		g.MemoryUsed = readBytes("mem_info_vram_used")
		temps, _ := filepath.Glob(filepath.Join(card, "hwmon/hwmon*/temp1_input"))
		if len(temps) > 0 {
			b, _ := os.ReadFile(temps[0])
			if v := gpuNumber(string(b)); v != nil {
				*v /= 1000
				g.Temperature = v
			}
		}
		out = append(out, g)
		if len(out) >= 32 {
			break
		}
	}
	if len(out) > 0 {
		return out, "available"
	}
	if hasDevice {
		return out, "unsupported"
	}
	return out, "unsupported"
}

type boundedOutput struct {
	bytes.Buffer
	limit int
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.limit - b.Len()
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		_, _ = b.Buffer.Write(p)
	}
	return n, nil
}
