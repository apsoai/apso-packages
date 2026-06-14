import { DomainEvent } from '../domain-event.entity';
import { DeliveryDestination } from './delivery-destination';

/**
 * SqsDestination sends each domain event to an Amazon SQS queue.
 *
 * The AWS SDK is loaded LAZILY (require) so it is only needed when this
 * destination is actually activated at runtime (EVENTS_DESTINATION=sqs). Install
 * it in the deploying service: `npm install @aws-sdk/client-sqs`.
 *
 * Env:
 *   AWS_REGION           — AWS region (required)
 *   EVENTS_SQS_QUEUE_URL — target queue URL (required)
 */
export class SqsDestination implements DeliveryDestination {
  readonly name = 'sqs';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private load(): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      return require('@aws-sdk/client-sqs');
    } catch {
      throw new Error(
        "EVENTS_DESTINATION=sqs requires '@aws-sdk/client-sqs' — run " +
          '`npm install @aws-sdk/client-sqs`',
      );
    }
  }

  async send(event: DomainEvent): Promise<void> {
    const queueUrl = process.env.EVENTS_SQS_QUEUE_URL;
    if (!queueUrl) {
      throw new Error('EVENTS_SQS_QUEUE_URL is not set');
    }
    const { SQSClient, SendMessageCommand } = this.load();
    if (!this.client) {
      this.client = new SQSClient({ region: process.env.AWS_REGION });
    }
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(event),
      }),
    );
  }
}
