package agent

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"golang.org/x/net/icmp"
	"golang.org/x/net/ipv4"
	"golang.org/x/net/ipv6"
	"net"
	"net/http"
	"net/netip"
	"os"
	"remoter/internal/agentproto"
	"syscall"
	"time"
)

// Explicit targets may be private hosts. Metadata, unspecified and multicast
// addresses are never valid network quality targets, including after DNS lookup.
func checkAddress(ip netip.Addr) bool {
	ip = ip.Unmap()
	return (ip.IsGlobalUnicast() || ip.IsLoopback()) && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified() && !netip.MustParsePrefix("100.64.0.0/10").Contains(ip) && ip.String() != "168.63.129.16" && !netip.MustParsePrefix("64:ff9b::/96").Contains(ip)
}
func resolveTarget(ctx context.Context, host string) ([]netip.Addr, error) {
	ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
	if e != nil || len(ips) == 0 {
		return nil, errors.New("resolution failed")
	}
	for _, ip := range ips {
		if !checkAddress(ip) {
			return nil, errors.New("target address denied")
		}
	}
	return ips, nil
}
func checkDial(ctx context.Context, address string) (net.Conn, error) {
	host, port, e := net.SplitHostPort(address)
	if e != nil {
		return nil, e
	}
	ips, e := resolveTarget(ctx, host)
	if e != nil {
		return nil, e
	}
	return (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(ips[0].String(), port))
}
func Check(ctx context.Context, t agentproto.CheckTarget) agentproto.CheckResult {
	r := agentproto.CheckResult{TargetID: t.ID, Kind: t.Kind, CheckedAt: time.Now().UTC()}
	if e := t.Validate(); e != nil {
		r.Unavailable = true
		r.Error = "invalid target"
		return r
	}
	ctx, cancel := context.WithTimeout(ctx, time.Duration(t.TimeoutMS)*time.Millisecond)
	defer cancel()
	start := time.Now()
	var e error
	switch t.Kind {
	case "tcp":
		var conn net.Conn
		conn, e = checkDial(ctx, net.JoinHostPort(t.Host, fmt.Sprint(t.Port)))
		if e == nil {
			conn.Close()
		}
	case "http":
		transport := &http.Transport{DialContext: func(ctx context.Context, _, address string) (net.Conn, error) { return checkDial(ctx, address) }, DisableKeepAlives: true, TLSHandshakeTimeout: time.Duration(t.TimeoutMS) * time.Millisecond, MaxResponseHeaderBytes: 16 << 10}
		defer transport.CloseIdleConnections()
		client := &http.Client{Transport: transport, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, t.URL, nil)
		req.Header.Set("User-Agent", "Hoshi-Agent/"+agentproto.Version)
		var res *http.Response
		res, e = client.Do(req)
		if e == nil {
			res.Body.Close()
			if res.StatusCode < 200 || res.StatusCode >= 400 {
				e = errors.New("HTTP status outside 200–399")
			}
		}
	case "icmp":
		e = icmpEcho(ctx, t.Host)
	}
	r.Success = e == nil
	r.LatencyMS = float64(time.Since(start).Microseconds()) / 1000
	if e != nil {
		r.Error = "target failed"
		if errors.Is(e, context.DeadlineExceeded) {
			r.Error = "timeout"
		}
		if errors.Is(e, os.ErrPermission) || errors.Is(e, syscall.EPERM) || errors.Is(e, syscall.EACCES) {
			r.Unavailable = true
			r.Error = "ICMP permission unavailable"
		}
	}
	return r
}
func icmpEcho(ctx context.Context, host string) error {
	ips, e := resolveTarget(ctx, host)
	if e != nil {
		return e
	}
	ip := ips[0].Unmap()
	proto := 1
	network := "udp4"
	bind := "0.0.0.0"
	raw := "ip4:icmp"
	var typ icmp.Type = ipv4.ICMPTypeEcho
	var reply icmp.Type = ipv4.ICMPTypeEchoReply
	if ip.Is6() {
		proto = 58
		network = "udp6"
		bind = "::"
		raw = "ip6:ipv6-icmp"
		typ = ipv6.ICMPTypeEchoRequest
		reply = ipv6.ICMPTypeEchoReply
	}
	conn, e := icmp.ListenPacket(network, bind)
	isRaw := false
	if e != nil {
		conn, e = icmp.ListenPacket(raw, bind)
		isRaw = true
	}
	if e != nil {
		return e
	}
	defer conn.Close()
	stop := context.AfterFunc(ctx, func() { conn.Close() })
	defer stop()
	deadline, _ := ctx.Deadline()
	conn.SetDeadline(deadline)
	payload := make([]byte, 24)
	if _, e = rand.Read(payload); e != nil {
		return e
	}
	id := int(binary.BigEndian.Uint16(payload[:2]))
	seq := int(binary.BigEndian.Uint16(payload[2:4]))
	msg := icmp.Message{Type: typ, Code: 0, Body: &icmp.Echo{ID: id, Seq: seq, Data: payload}}
	b, e := msg.Marshal(nil)
	if e != nil {
		return e
	}
	var dst net.Addr = &net.UDPAddr{IP: net.IP(ip.AsSlice())}
	if isRaw {
		dst = &net.IPAddr{IP: net.IP(ip.AsSlice())}
	}
	if _, e = conn.WriteTo(b, dst); e != nil {
		return e
	}
	buf := make([]byte, 1500)
	for {
		n, peer, e := conn.ReadFrom(buf)
		if e != nil {
			return e
		}
		p, e := icmp.ParseMessage(proto, buf[:n])
		if e != nil || p.Type != reply {
			continue
		}
		echo, ok := p.Body.(*icmp.Echo)
		if !ok || echo.Seq != seq || string(echo.Data) != string(payload) {
			continue
		}
		if isRaw && echo.ID != id {
			continue
		}
		var source net.IP
		switch a := peer.(type) {
		case *net.IPAddr:
			source = a.IP
		case *net.UDPAddr:
			source = a.IP
		}
		if source.Equal(net.IP(ip.AsSlice())) {
			return nil
		}
	}
}
