import { DomainEvent } from '../domain-event.entity';
import { DeliveryDestination } from './delivery-destination';

/**
 * EventBridgeDestination puts each domain event onto an Amazon EventBridge bus.
 *
 * The AWS SDK is loaded LAZILY (require) so it is only needed when this
 * destination is actually activated at runtime (EVENTS_DESTINATION=eventbridge).
 * Install it in the deploying service: `npm install @aws-sdk/client-eventbridge`.
 *
 * Each event is put with `Source='apso.domain-events'` and
 * `DetailType=event.type`.
 *
 * Env:
 *   AWS_REGION             — AWS region (required)
 *   EVENTS_EVENTBRIDGE_BUS — target event bus name (required)
 */
export class EventBridgeDestination implements DeliveryDestination {
  readonly name = 'eventbridge';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client?: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private load(): any {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      return require('@aws-sdk/client-eventbridge');
    } catch {
      throw new Error(
        "EVENTS_DESTINATION=eventbridge requires '@aws-sdk/client-eventbridge' — run " +
          '`npm install @aws-sdk/client-eventbridge`',
      );
    }
  }

  async send(event: DomainEvent): Promise<void> {
    const busName = process.env.EVENTS_EVENTBRIDGE_BUS;
    if (!busName) {
      throw new Error('EVENTS_EVENTBRIDGE_BUS is not set');
    }
    const { EventBridgeClient, PutEventsCommand } = this.load();
    if (!this.client) {
      this.client = new EventBridgeClient({ region: process.env.AWS_REGION });
    }
    await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: busName,
            Source: 'apso.domain-events',
            DetailType: event.type,
            Detail: JSON.stringify(event),
          },
        ],
      }),
    );
  }
}
