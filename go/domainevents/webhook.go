package domainevents

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// webhookDestination delivers events to a single configured HTTP sink, signed per
// the Standard Webhooks spec (https://www.standardwebhooks.com/). It is a single
// configured sink, NOT a multi-subscriber registry.
type webhookDestination struct {
	url    string
	secret string
	client *http.Client
}

// newWebhookDestination reads EVENTS_WEBHOOK_URL and EVENTS_WEBHOOK_SECRET.
func newWebhookDestination() (DeliveryDestination, error) {
	url := strings.TrimSpace(os.Getenv("EVENTS_WEBHOOK_URL"))
	secret := strings.TrimSpace(os.Getenv("EVENTS_WEBHOOK_SECRET"))
	if url == "" {
		return nil, fmt.Errorf("domainevents: webhook destination requires EVENTS_WEBHOOK_URL")
	}
	if secret == "" {
		return nil, fmt.Errorf("domainevents: webhook destination requires EVENTS_WEBHOOK_SECRET")
	}
	return &webhookDestination{
		url:    url,
		secret: secret,
		client: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (w *webhookDestination) Name() string { return "webhook" }

// Send POSTs the signed event body. Non-2xx → error so the relay retries.
func (w *webhookDestination) Send(ctx context.Context, ev *DomainEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	ts := time.Now().Unix()
	sig, err := signWebhook(ev.ID, ts, body, w.secret)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("webhook-id", ev.ID)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("webhook-signature", sig)

	resp, err := w.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("domainevents: webhook returned status %d", resp.StatusCode)
	}
	return nil
}

// signWebhook computes the Standard Webhooks signature header value "v1,{signature}".
//
//	signedContent = "{id}.{timestamp}.{body}"
//	secretBytes   = base64_decode(secret without the "whsec_" prefix)
//	signature     = base64( HMAC_SHA256(signedContent, secretBytes) )
func signWebhook(id string, timestamp int64, body []byte, secret string) (string, error) {
	key := strings.TrimPrefix(secret, "whsec_")
	secretBytes, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		return "", fmt.Errorf("domainevents: invalid webhook secret: %w", err)
	}
	var sb strings.Builder
	sb.WriteString(id)
	sb.WriteByte('.')
	sb.WriteString(strconv.FormatInt(timestamp, 10))
	sb.WriteByte('.')
	sb.Write(body)

	mac := hmac.New(sha256.New, secretBytes)
	mac.Write([]byte(sb.String()))
	sig := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return "v1," + sig, nil
}
