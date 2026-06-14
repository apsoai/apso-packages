package domainevents

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
)

// eventBridgeSource is the fixed Source attribute for all emitted events.
const eventBridgeSource = "apso.domain-events"

// eventBridgeClient is the subset of the EventBridge API used here.
type eventBridgeClient interface {
	PutEvents(ctx context.Context, params *eventbridge.PutEventsInput, optFns ...func(*eventbridge.Options)) (*eventbridge.PutEventsOutput, error)
}

// eventBridgeDestination publishes events to an EventBridge bus.
type eventBridgeDestination struct {
	client eventBridgeClient
	bus    string
}

// newEventBridgeDestination reads AWS_REGION and EVENTS_EVENTBRIDGE_BUS.
func newEventBridgeDestination() (DeliveryDestination, error) {
	bus := strings.TrimSpace(os.Getenv("EVENTS_EVENTBRIDGE_BUS"))
	if bus == "" {
		return nil, fmt.Errorf("domainevents: eventbridge destination requires EVENTS_EVENTBRIDGE_BUS")
	}
	region := strings.TrimSpace(os.Getenv("AWS_REGION"))
	if region == "" {
		return nil, fmt.Errorf("domainevents: eventbridge destination requires AWS_REGION")
	}
	cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("domainevents: failed to load AWS config: %w", err)
	}
	return &eventBridgeDestination{
		client: eventbridge.NewFromConfig(cfg),
		bus:    bus,
	}, nil
}

func (e *eventBridgeDestination) Name() string { return "eventbridge" }

// Send puts one event with Source='apso.domain-events' and DetailType=event.type.
// A failed entry count > 0 is treated as an error so the relay retries.
func (e *eventBridgeDestination) Send(ctx context.Context, ev *DomainEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	out, err := e.client.PutEvents(ctx, &eventbridge.PutEventsInput{
		Entries: []ebtypes.PutEventsRequestEntry{
			{
				Source:       aws.String(eventBridgeSource),
				DetailType:   aws.String(ev.Type),
				Detail:       aws.String(string(body)),
				EventBusName: aws.String(e.bus),
			},
		},
	})
	if err != nil {
		return err
	}
	if out != nil && out.FailedEntryCount > 0 {
		return fmt.Errorf("domainevents: eventbridge reported %d failed entries", out.FailedEntryCount)
	}
	return nil
}
