package domainevents

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/segmentio/kafka-go"
)

// kafkaDestination publishes events to a Kafka topic via segmentio/kafka-go.
type kafkaDestination struct {
	writer *kafka.Writer
	topic  string
}

// newKafkaDestination reads EVENTS_KAFKA_BROKERS (comma-separated) and EVENTS_KAFKA_TOPIC.
func newKafkaDestination() (DeliveryDestination, error) {
	brokersRaw := strings.TrimSpace(os.Getenv("EVENTS_KAFKA_BROKERS"))
	topic := strings.TrimSpace(os.Getenv("EVENTS_KAFKA_TOPIC"))
	if brokersRaw == "" {
		return nil, fmt.Errorf("domainevents: kafka destination requires EVENTS_KAFKA_BROKERS")
	}
	if topic == "" {
		return nil, fmt.Errorf("domainevents: kafka destination requires EVENTS_KAFKA_TOPIC")
	}
	var brokers []string
	for _, b := range strings.Split(brokersRaw, ",") {
		if b = strings.TrimSpace(b); b != "" {
			brokers = append(brokers, b)
		}
	}
	writer := &kafka.Writer{
		Addr:     kafka.TCP(brokers...),
		Topic:    topic,
		Balancer: &kafka.LeastBytes{},
	}
	return &kafkaDestination{writer: writer, topic: topic}, nil
}

func (k *kafkaDestination) Name() string { return "kafka" }

// Send writes the event body keyed by event ID. Errors propagate for retry.
func (k *kafkaDestination) Send(ctx context.Context, ev *DomainEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	return k.writer.WriteMessages(ctx, kafka.Message{
		Key:   []byte(ev.ID),
		Value: body,
		Headers: []kafka.Header{
			{Key: "event-type", Value: []byte(ev.Type)},
			{Key: "event-id", Value: []byte(ev.ID)},
		},
	})
}
