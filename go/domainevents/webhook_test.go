package domainevents

import "testing"

// TestSignWebhook_OfficialVector asserts the Standard Webhooks official test vector
// from CONTRACT.md §6. This is the mandatory cross-language conformance test.
func TestSignWebhook_OfficialVector(t *testing.T) {
	const (
		id        = "msg_p5jXN8AQM9LWM0D4loKWxJek"
		timestamp = int64(1614265330)
		secret    = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
		want      = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE="
	)
	// exact bytes: {"test": 2432232314}
	body := []byte(`{"test": 2432232314}`)

	got, err := signWebhook(id, timestamp, body, secret)
	if err != nil {
		t.Fatalf("signWebhook returned error: %v", err)
	}
	if got != want {
		t.Fatalf("signature mismatch:\n got: %q\nwant: %q", got, want)
	}
}

func TestSignWebhook_InvalidSecret(t *testing.T) {
	_, err := signWebhook("id", 1, []byte("{}"), "whsec_***not base64***")
	if err == nil {
		t.Fatal("expected error for non-base64 secret, got nil")
	}
}
