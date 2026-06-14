package domainevents

import (
	"context"
	"fmt"
	"os"
	"strings"
)

// DeliveryDestination is a pure transport sink. Send pushes one event to one sink
// and returns an error on failure so the relay can retry.
type DeliveryDestination interface {
	// Name returns the destination's registered name (e.g. "webhook").
	Name() string
	// Send delivers a single event. It MUST return an error on failure.
	Send(ctx context.Context, ev *DomainEvent) error
}

// destinationFactory maps a destination name to its adapter constructor.
// Each constructor reads its own env vars and may return an error if misconfigured.
var destinationFactory = map[string]func() (DeliveryDestination, error){
	"webhook":     newWebhookDestination,
	"kafka":       newKafkaDestination,
	"sqs":         newSQSDestination,
	"eventbridge": newEventBridgeDestination,
}

// resolveDestinations reads EVENTS_DESTINATION (comma-separated) and constructs the
// active destinations. An unknown name is a startup error. Empty/unset → no
// destinations (relay is a no-op until configured).
func resolveDestinations() ([]DeliveryDestination, error) {
	return resolveDestinationsFrom(os.Getenv("EVENTS_DESTINATION"))
}

// resolveDestinationsFrom is the testable core of resolveDestinations.
func resolveDestinationsFrom(raw string) ([]DeliveryDestination, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var dests []DeliveryDestination
	for _, part := range strings.Split(raw, ",") {
		name := strings.TrimSpace(part)
		if name == "" {
			continue
		}
		ctor, ok := destinationFactory[name]
		if !ok {
			return nil, fmt.Errorf("domainevents: unknown EVENTS_DESTINATION %q (valid: webhook, kafka, sqs, eventbridge)", name)
		}
		d, err := ctor()
		if err != nil {
			return nil, err
		}
		dests = append(dests, d)
	}
	return dests, nil
}
