package app

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func (s *Server) billingEnabled() bool {
	return s.cfg.StripeKey != "" && s.cfg.StripeWebhookSecret != "" && s.cfg.StripePriceID != "" && s.cfg.SubscriptionCredits > 0 && s.cfg.SubscriptionCredits <= 1e9 && s.cfg.SubscriptionKey != "" && s.cfg.SubscriptionModel != "" && validAIURL(s.cfg.SubscriptionURL) == nil
}
func (s *Server) billingConfig(w http.ResponseWriter, r *http.Request) {
	var customer string
	e := s.db.QueryRow(r.Context(), "SELECT customer_id FROM billing_customers WHERE user_id=$1", uid(r)).Scan(&customer)
	if e != nil && !isMissing(e) {
		s.dbError(w, e)
		return
	}
	respond(w, 200, map[string]any{"enabled": s.billingEnabled(), "creditsPerPeriod": s.cfg.SubscriptionCredits, "hasCustomer": customer != ""})
}
func (s *Server) stripeRequest(ctx context.Context, method, endpoint string, data url.Values) (map[string]any, error) {
	base := s.cfg.stripeBaseURL
	if base == "" {
		base = "https://api.stripe.com/v1/"
	}
	target := base + endpoint
	body := ""
	if method == "GET" {
		target += "?" + data.Encode()
	} else {
		body = data.Encode()
	}
	req, e := http.NewRequestWithContext(ctx, method, target, strings.NewReader(body))
	if e != nil {
		return nil, e
	}
	req.SetBasicAuth(s.cfg.StripeKey, "")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Stripe-Version", "2025-02-24.acacia")
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("redirect denied") }}
	if s.cfg.stripeClient != nil {
		client = s.cfg.stripeClient
	}
	res, e := client.Do(req)
	if e != nil {
		return nil, errors.New("billing provider unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, errors.New("billing provider rejected request")
	}
	var v map[string]any
	e = json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&v)
	return v, e
}

func (s *Server) stripe(ctx context.Context, endpoint string, data url.Values) (map[string]any, error) {
	return s.stripeRequest(ctx, "POST", endpoint, data)
}
func (s *Server) billingCheckout(w http.ResponseWriter, r *http.Request) {
	if !s.billingEnabled() {
		fail(w, 503, "subscriptions unavailable on this deployment")
		return
	}
	if !s.allow("checkout:"+uid(r), 3, time.Minute) {
		fail(w, 429, "try again later")
		return
	}
	var existing string
	s.db.QueryRow(r.Context(), "SELECT customer_id FROM billing_customers WHERE user_id=$1", uid(r)).Scan(&existing)
	tx, e := s.db.Begin(r.Context())
	if e != nil {
		s.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,7))", uid(r)); e != nil {
		s.dbError(w, e)
		return
	}
	if existing != "" {
		result, err := s.stripeRequest(r.Context(), "GET", "subscriptions", url.Values{"customer": {existing}, "status": {"all"}, "limit": {"100"}})
		if err != nil {
			fail(w, 502, err.Error())
			return
		}
		if hasMore, _ := result["has_more"].(bool); hasMore {
			fail(w, 409, "contact billing support before subscribing again")
			return
		}
		items, ok := result["data"].([]any)
		if !ok {
			fail(w, 502, "invalid billing response")
			return
		}
		for _, item := range items {
			record, ok := item.(map[string]any)
			if !ok {
				fail(w, 502, "invalid subscription response")
				return
			}
			state, _ := record["status"].(string)
			if state != "canceled" && state != "incomplete_expired" {
				fail(w, 409, "manage your current subscription in the billing portal")
				return
			}
		}
	}
	var cached string
	e = tx.QueryRow(r.Context(), "SELECT url FROM billing_checkouts WHERE user_id=$1 AND expires_at>now()+interval '1 minute'", uid(r)).Scan(&cached)
	if e == nil {
		respond(w, 200, map[string]string{"url": cached})
		return
	}
	if !isMissing(e) {
		s.dbError(w, e)
		return
	}
	v := url.Values{"mode": {"subscription"}, "line_items[0][price]": {s.cfg.StripePriceID}, "line_items[0][quantity]": {"1"}, "client_reference_id": {uid(r)}, "subscription_data[metadata][remoter_user_id]": {uid(r)}, "success_url": {s.cfg.Origin + "/?billing=success"}, "cancel_url": {s.cfg.Origin + "/?billing=cancelled"}}
	if existing != "" {
		v.Set("customer", existing)
	}
	out, e := s.stripe(r.Context(), "checkout/sessions", v)
	if e != nil {
		fail(w, 502, e.Error())
		return
	}
	target, _ := out["url"].(string)
	if !strings.HasPrefix(target, "https://checkout.stripe.com/") {
		fail(w, 502, "invalid checkout URL")
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO billing_checkouts(user_id,url,expires_at) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET url=$2,expires_at=$3", uid(r), target, time.Now().Add(23*time.Hour))
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		s.dbError(w, e)
		return
	}
	respond(w, 200, map[string]string{"url": target})
}
func (s *Server) billingPortal(w http.ResponseWriter, r *http.Request) {
	if !s.billingEnabled() {
		fail(w, 503, "subscriptions unavailable")
		return
	}
	var customer string
	if e := s.db.QueryRow(r.Context(), "SELECT customer_id FROM billing_customers WHERE user_id=$1", uid(r)).Scan(&customer); e != nil {
		fail(w, 404, "billing account not found")
		return
	}
	out, e := s.stripe(r.Context(), "billing_portal/sessions", url.Values{"customer": {customer}, "return_url": {s.cfg.Origin}})
	if e != nil {
		fail(w, 502, e.Error())
		return
	}
	target, _ := out["url"].(string)
	if !strings.HasPrefix(target, "https://billing.stripe.com/") {
		fail(w, 502, "invalid portal URL")
		return
	}
	respond(w, 200, map[string]string{"url": target})
}
func verifyStripe(payload []byte, header, secret string, now time.Time) bool {
	var timestamp int64
	var signatures []string
	for _, item := range strings.Split(header, ",") {
		kv := strings.SplitN(strings.TrimSpace(item), "=", 2)
		if len(kv) != 2 {
			continue
		}
		if kv[0] == "t" {
			timestamp, _ = strconv.ParseInt(kv[1], 10, 64)
		}
		if kv[0] == "v1" {
			signatures = append(signatures, kv[1])
		}
	}
	if timestamp == 0 || timestamp < now.Unix()-300 || timestamp > now.Unix()+300 || secret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(strconv.FormatInt(timestamp, 10) + "."))
	mac.Write(payload)
	want := mac.Sum(nil)
	for _, sig := range signatures {
		b, e := hex.DecodeString(sig)
		if e == nil && hmac.Equal(b, want) {
			return true
		}
	}
	return false
}
func (s *Server) billingWebhook(w http.ResponseWriter, r *http.Request) {
	payload, e := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if e != nil || !verifyStripe(payload, r.Header.Get("Stripe-Signature"), s.cfg.StripeWebhookSecret, time.Now()) {
		fail(w, 400, "invalid webhook signature")
		return
	}
	var event struct {
		ID   string `json:"id"`
		Type string `json:"type"`
		Data struct {
			Object json.RawMessage `json:"object"`
		} `json:"data"`
	}
	if json.Unmarshal(payload, &event) != nil || event.ID == "" {
		fail(w, 400, "invalid event")
		return
	}
	switch event.Type {
	case "checkout.session.completed":
		var v struct {
			Customer string `json:"customer"`
			User     string `json:"client_reference_id"`
			Mode     string `json:"mode"`
		}
		if json.Unmarshal(event.Data.Object, &v) != nil || v.Mode != "subscription" || v.User == "" || v.Customer == "" {
			fail(w, 400, "invalid checkout event")
			return
		}
		_, e = s.db.Exec(r.Context(), "INSERT INTO billing_customers(user_id,customer_id) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING", v.User, v.Customer)
		if e != nil {
			s.dbError(w, e)
			return
		}
		_, e = s.db.Exec(r.Context(), "DELETE FROM billing_checkouts WHERE user_id=$1", v.User)
		if e != nil {
			s.dbError(w, e)
			return
		}
	case "invoice.paid":
		var v struct {
			ID       string `json:"id"`
			Customer string `json:"customer"`
			Paid     bool   `json:"paid"`
			Reason   string `json:"billing_reason"`
			Lines    struct {
				Data []struct {
					Price struct {
						ID string `json:"id"`
					} `json:"price"`
					Quantity int `json:"quantity"`
				} `json:"data"`
			} `json:"lines"`
		}
		if json.Unmarshal(event.Data.Object, &v) != nil || !v.Paid || v.ID == "" {
			fail(w, 400, "invalid invoice")
			return
		}
		if v.Reason != "subscription_create" && v.Reason != "subscription_cycle" {
			respond(w, 200, map[string]bool{"ignored": true})
			return
		}
		matches := false
		for _, line := range v.Lines.Data {
			if line.Price.ID == s.cfg.StripePriceID && line.Quantity == 1 {
				matches = true
			}
		}
		if !matches || s.cfg.SubscriptionCredits <= 0 || s.cfg.SubscriptionCredits > 1e9 {
			fail(w, 400, "invoice price not configured")
			return
		}
		var user string
		if e = s.db.QueryRow(r.Context(), "SELECT user_id FROM billing_customers WHERE customer_id=$1", v.Customer).Scan(&user); e != nil {
			fail(w, 409, "checkout mapping not yet available; retry event")
			return
		}
		tx, e := s.db.Begin(r.Context())
		if e != nil {
			s.dbError(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		tag, e := tx.Exec(r.Context(), "INSERT INTO billing_events(event_id,invoice_id,user_id,amount) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", event.ID, v.ID, user, s.cfg.SubscriptionCredits)
		if e == nil && tag.RowsAffected() == 1 {
			_, e = tx.Exec(r.Context(), "INSERT INTO credits(user_id,balance) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET balance=credits.balance+$2", user, s.cfg.SubscriptionCredits)
		}
		if e == nil {
			e = tx.Commit(r.Context())
		}
		if e != nil {
			s.dbError(w, e)
			return
		}
	}
	respond(w, 200, map[string]bool{"ok": true})
}
