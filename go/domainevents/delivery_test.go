package domainevents

import (
	"os"
	"testing"
)

func TestResolveDestinations_Unknown(t *testing.T) {
	_, err := resolveDestinationsFrom("kafka,bogus")
	if err == nil {
		t.Fatal("expected error for unknown destination, got nil")
	}
}

func TestResolveDestinations_Empty(t *testing.T) {
	dests, err := resolveDestinationsFrom("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dests) != 0 {
		t.Fatalf("expected 0 destinations, got %d", len(dests))
	}
}

func TestResolveDestinations_Webhook(t *testing.T) {
	t.Setenv("EVENTS_WEBHOOK_URL", "https://example.com/hook")
	t.Setenv("EVENTS_WEBHOOK_SECRET", "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw")

	dests, err := resolveDestinationsFrom("webhook")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dests) != 1 || dests[0].Name() != "webhook" {
		t.Fatalf("expected one webhook destination, got %+v", dests)
	}
}

func TestResolveDestinations_WebhookMissingConfig(t *testing.T) {
	// Ensure env is clear.
	os.Unsetenv("EVENTS_WEBHOOK_URL")
	os.Unsetenv("EVENTS_WEBHOOK_SECRET")

	_, err := resolveDestinationsFrom("webhook")
	if err == nil {
		t.Fatal("expected error for missing webhook config, got nil")
	}
}

func TestResolveDestinations_ReadsEnvVar(t *testing.T) {
	t.Setenv("EVENTS_DESTINATION", "")
	dests, err := resolveDestinations()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(dests) != 0 {
		t.Fatalf("expected 0 destinations for empty env, got %d", len(dests))
	}
}
