package app

import (
	"crypto/x509"
	"encoding/base64"
	"errors"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	monitorHTTPClient                                   *http.Client
	stripeBaseURL                                       string
	stripeClient                                        *http.Client
	aiRootCAs                                           *x509.CertPool
	Address, DatabaseURL, Origin, WebDir, AgentDir      string
	Key                                                 []byte
	SecureCookies, Registration                         bool
	TrustedProxyCIDRs                                   []string
	SSHAllowedCIDRs                                     []string
	AIAllowedCIDRs                                      []string
	SubscriptionURL, SubscriptionKey, SubscriptionModel string
	StripeKey, StripeWebhookSecret, StripePriceID       string
	SubscriptionCredits                                 int64
	AdminToken                                          string
	SessionTTL                                          time.Duration
	TaskRetentionDays                                   int
}

func ConfigFromEnv() (Config, error) {
	c := Config{Address: env("LISTEN_ADDR", ":8080"), DatabaseURL: os.Getenv("DATABASE_URL"), Origin: env("PUBLIC_ORIGIN", "http://localhost:8080"), WebDir: env("WEB_DIR", "web/dist"), AgentDir: env("AGENT_DIR", "agents"), Registration: os.Getenv("ALLOW_REGISTRATION") == "true", SessionTTL: 24 * time.Hour, SubscriptionURL: os.Getenv("SUBSCRIPTION_API_URL"), SubscriptionKey: secretEnv("SUBSCRIPTION_API_KEY"), SubscriptionModel: os.Getenv("SUBSCRIPTION_MODEL"), AdminToken: secretEnv("BILLING_ADMIN_TOKEN")}
	c.StripeKey = secretEnv("STRIPE_SECRET_KEY")
	c.StripeWebhookSecret = secretEnv("STRIPE_WEBHOOK_SECRET")
	c.StripePriceID = os.Getenv("STRIPE_PRICE_ID")
	c.SubscriptionCredits, _ = strconv.ParseInt(os.Getenv("SUBSCRIPTION_CREDITS"), 10, 64)
	c.TaskRetentionDays = 30
	if raw := os.Getenv("TASK_RETENTION_DAYS"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 365 {
			return c, errors.New("TASK_RETENTION_DAYS must be 1–365")
		}
		c.TaskRetentionDays = n
	}
	var err error
	c.Key, err = base64.StdEncoding.DecodeString(secretEnv("MASTER_KEY"))
	if err != nil || len(c.Key) != 32 {
		return c, errors.New("MASTER_KEY must be base64 of exactly 32 random bytes")
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return c, errors.New("PUBLIC_ORIGIN must be a bare http(s) origin")
	}
	c.SecureCookies = u.Scheme == "https"
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL is required")
	}
	c.TrustedProxyCIDRs = split(os.Getenv("TRUSTED_PROXY_CIDRS"))
	c.SSHAllowedCIDRs = split(os.Getenv("SSH_ALLOWED_CIDRS"))
	c.AIAllowedCIDRs = split(os.Getenv("AI_ALLOWED_CIDRS"))
	for _, list := range [][]string{c.TrustedProxyCIDRs, c.SSHAllowedCIDRs, c.AIAllowedCIDRs} {
		for _, cidr := range list {
			if _, e := netip.ParsePrefix(strings.TrimSpace(cidr)); e != nil {
				return c, errors.New("invalid CIDR configuration")
			}
		}
	}
	return c, nil
}
func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
func split(v string) []string {
	if v == "" {
		return nil
	}
	return strings.Split(v, ",")
}

func secretEnv(k string) string {
	if p := os.Getenv(k + "_FILE"); p != "" {
		b, e := os.ReadFile(p)
		if e != nil {
			return ""
		}
		return strings.TrimSpace(string(b))
	}
	return os.Getenv(k)
}
