package domainevents

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
)

// sqsClient is the subset of the SQS API used here (eases testing).
type sqsClient interface {
	SendMessage(ctx context.Context, params *sqs.SendMessageInput, optFns ...func(*sqs.Options)) (*sqs.SendMessageOutput, error)
}

// sqsDestination publishes events to an SQS queue via the AWS SDK v2.
type sqsDestination struct {
	client   sqsClient
	queueURL string
}

// newSQSDestination reads AWS_REGION and EVENTS_SQS_QUEUE_URL.
func newSQSDestination() (DeliveryDestination, error) {
	queueURL := strings.TrimSpace(os.Getenv("EVENTS_SQS_QUEUE_URL"))
	if queueURL == "" {
		return nil, fmt.Errorf("domainevents: sqs destination requires EVENTS_SQS_QUEUE_URL")
	}
	region := strings.TrimSpace(os.Getenv("AWS_REGION"))
	if region == "" {
		return nil, fmt.Errorf("domainevents: sqs destination requires AWS_REGION")
	}
	cfg, err := config.LoadDefaultConfig(context.Background(), config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("domainevents: failed to load AWS config: %w", err)
	}
	return &sqsDestination{
		client:   sqs.NewFromConfig(cfg),
		queueURL: queueURL,
	}, nil
}

func (s *sqsDestination) Name() string { return "sqs" }

// Send sends the event body as the message body. Errors propagate for retry.
func (s *sqsDestination) Send(ctx context.Context, ev *DomainEvent) error {
	body, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	_, err = s.client.SendMessage(ctx, &sqs.SendMessageInput{
		QueueUrl:    aws.String(s.queueURL),
		MessageBody: aws.String(string(body)),
	})
	return err
}
