package app

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"time"
)

func allowedAddress(ip netip.Addr, kind string, cidrs []string) bool {
	ip = ip.Unmap()
	for _, s := range cidrs {
		p, e := netip.ParsePrefix(strings.TrimSpace(s))
		if e == nil && p.Contains(ip) {
			return true
		}
	}
	for _, blocked := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "198.18.0.0/15", "168.63.129.16/32", "64:ff9b::/96", "64:ff9b:1::/48"} {
		if netip.MustParsePrefix(blocked).Contains(ip) {
			return false
		}
	}
	if !ip.IsGlobalUnicast() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return false
	}
	if kind == "ai" && ip.IsPrivate() {
		return false
	}
	return true
}
func safeDial(ctx context.Context, address, kind string, cidrs []string) (net.Conn, error) {
	h, p, e := net.SplitHostPort(address)
	if e != nil {
		return nil, e
	}
	ips, e := net.DefaultResolver.LookupNetIP(ctx, "ip", h)
	if e != nil {
		return nil, errors.New("address resolution failed")
	}
	if len(ips) == 0 {
		return nil, errors.New("no address found")
	}
	for _, ip := range ips {
		if !allowedAddress(ip, kind, cidrs) {
			return nil, errors.New("address denied by network policy")
		}
	}
	d := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	var last error
	for _, ip := range ips {
		c, e := d.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), p))
		if e == nil {
			return c, nil
		}
		last = e
	}
	return nil, last
}

func trustedClientIP(peer, forwarded string, cidrs []string) string {
	trusted := func(raw string) bool {
		ip, e := netip.ParseAddr(strings.TrimSpace(raw))
		if e != nil {
			return false
		}
		for _, raw := range cidrs {
			p, e := netip.ParsePrefix(strings.TrimSpace(raw))
			if e == nil && p.Contains(ip.Unmap()) {
				return true
			}
		}
		return false
	}
	if !trusted(peer) {
		return peer
	}
	chain := strings.Split(forwarded, ",")
	for i := len(chain) - 1; i >= 0; i-- {
		ip, e := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if e != nil {
			return peer
		}
		if !trusted(ip.String()) {
			return ip.String()
		}
	}
	return peer
}
