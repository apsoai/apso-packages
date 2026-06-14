import {
  DeliveryDestination,
  DOMAIN_EVENT_DESTINATIONS,
} from './delivery-destination';
import { WebhookDestination } from './webhook.destination';
import { KafkaDestination } from './kafka.destination';
import { SqsDestination } from './sqs.destination';
import { EventBridgeDestination } from './eventbridge.destination';

export { DeliveryDestination, DOMAIN_EVENT_DESTINATIONS };
export { signWebhook, WebhookDestination } from './webhook.destination';
export { KafkaDestination } from './kafka.destination';
export { SqsDestination } from './sqs.destination';
export { EventBridgeDestination } from './eventbridge.destination';

/**
 * Factory for every supported {@link DeliveryDestination} adapter, keyed by
 * name. All adapters are always present; broker SDKs are loaded lazily inside
 * the adapter only when it is actually activated.
 */
const DESTINATION_FACTORIES: Record<string, () => DeliveryDestination> = {
  webhook: () => new WebhookDestination(),
  kafka: () => new KafkaDestination(),
  sqs: () => new SqsDestination(),
  eventbridge: () => new EventBridgeDestination(),
};

/**
 * Builds the ACTIVE set of destinations from the runtime `EVENTS_DESTINATION`
 * env var (comma-separated, trimmed). This is the ONLY place delivery is
 * selected — there is no build-time/`.apsorc` delivery config. An empty
 * EVENTS_DESTINATION means nothing is delivered (events stay `pending`).
 *
 * Broker client libraries are loaded lazily inside each adapter, so a service
 * only needs the dependency for the destination(s) it actually activates here.
 *
 * Delivery is at-least-once and, with multiple active destinations, re-sends to
 * ALL of them on retry — consumers MUST dedupe on `event.id`.
 *
 * An unknown EVENTS_DESTINATION value is a startup error.
 */
export function buildDestinations(): DeliveryDestination[] {
  const raw = process.env.EVENTS_DESTINATION ?? '';
  const names = raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  return names.map((name) => {
    const factory = DESTINATION_FACTORIES[name];
    if (!factory) {
      throw new Error(
        `EVENTS_DESTINATION '${name}' is not a known destination. ` +
          `Valid values: [${Object.keys(DESTINATION_FACTORIES).join(', ')}]`,
      );
    }
    return factory();
  });
}
