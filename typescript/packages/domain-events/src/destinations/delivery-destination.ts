import { DomainEvent } from '../domain-event.entity';

/**
 * DI token under which the active set of {@link DeliveryDestination} adapters is
 * provided. The {@link DomainEventRelay} injects this (optionally) and fans each
 * event out to every active destination.
 */
export const DOMAIN_EVENT_DESTINATIONS = 'DOMAIN_EVENT_DESTINATIONS';

/**
 * A DeliveryDestination is a pure transport: it takes a fully-formed
 * {@link DomainEvent} and pushes it to one external sink (a webhook URL, a Kafka
 * topic, an SQS queue, an EventBridge bus, ...).
 *
 * Adapters carry NO application semantics — the event type and payload are set
 * upstream by the {@link DomainEventMapper}. An adapter MUST throw on failure so
 * the relay retries (at-least-once delivery; consumers dedupe on `event.id`).
 */
export interface DeliveryDestination {
  /** The destination's stable name, matching its `EVENTS_DESTINATION` token. */
  readonly name: string;

  /**
   * Deliver a single event. Throw on any non-success so the relay retries.
   */
  send(event: DomainEvent): Promise<void>;
}
