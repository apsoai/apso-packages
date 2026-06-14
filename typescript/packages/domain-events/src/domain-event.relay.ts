import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DomainEvent } from './domain-event.entity';
import {
  DeliveryDestination,
  DOMAIN_EVENT_DESTINATIONS,
} from './destinations';

/**
 * Maximum number of delivery attempts before an event is marked 'failed'.
 */
export const MAX_ATTEMPTS = 5;

/**
 * Default poll interval (ms) for the self-contained drain loop.
 */
export const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * DI token carrying the poll interval (ms) for the relay's self-contained
 * poller. Provided by {@link DomainEventsModule.forRoot}.
 */
export const DOMAIN_EVENT_POLL_INTERVAL = 'DOMAIN_EVENT_POLL_INTERVAL';

/**
 * DomainEventRelay drains the durable `events` table and delivers pending
 * events. It is the consumer side of the transactional-outbox pattern: the
 * subscriber writes events transactionally, the relay publishes them
 * asynchronously with at-least-once semantics.
 *
 * SELF-CONTAINED POLLER: on application bootstrap the relay starts its own
 * `setInterval` drain loop and clears it on shutdown. It depends on NO external
 * scheduler package (no `@nestjs/schedule`). The interval defaults to
 * {@link DEFAULT_POLL_INTERVAL_MS} and is configurable via `forRoot`.
 *
 * DELIVERY: `publish()` fans each event out to every ACTIVE
 * {@link DeliveryDestination} (chosen at runtime via the `EVENTS_DESTINATION`
 * env var). Any thrown error bubbles so the relay retries.
 *
 * DUPLICATES — IMPORTANT: delivery is tracked at the event grain (a single
 * `events.status`), NOT per (event × destination). With MORE THAN ONE active
 * destination, a failure in any one destination retries the WHOLE event, so the
 * healthy destinations receive the event AGAIN on every retry. Consumer-side
 * dedupe on `event.id` is therefore MANDATORY, not optional, whenever you run
 * multiple destinations. (A single destination — the common case — never
 * duplicates beyond ordinary at-least-once.) You can override `publish()` to
 * change this behavior.
 */
@Injectable()
export class DomainEventRelay
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(DomainEventRelay.name);
  private timer?: ReturnType<typeof setInterval>;
  private draining = false;

  constructor(
    @InjectRepository(DomainEvent)
    private readonly events: Repository<DomainEvent>,
    @Optional()
    @Inject(DOMAIN_EVENT_DESTINATIONS)
    private readonly destinations: DeliveryDestination[] = [],
    @Optional()
    @Inject(DOMAIN_EVENT_POLL_INTERVAL)
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {}

  /**
   * Starts the self-contained periodic drain. Called by Nest on app bootstrap.
   */
  onApplicationBootstrap(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // Don't keep the event loop alive solely for the poller.
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  /**
   * Stops the periodic drain. Called by Nest on shutdown.
   */
  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One non-overlapping drain pass. Errors are swallowed (logged) so a single
   * bad tick never kills the interval.
   */
  private async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.processPending();
    } catch (error) {
      this.logger.error(
        'DomainEventRelay drain tick failed',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.draining = false;
    }
  }

  /**
   * Load pending events oldest-first and deliver each. On success the event is
   * marked `published` with `publishedAt`; on failure `attempts` increments and
   * the event is marked `failed` once `attempts >= MAX_ATTEMPTS`.
   */
  async processPending(limit = 50): Promise<void> {
    const pending = await this.events.find({
      where: { status: 'pending' },
      order: { created_at: 'ASC' },
      take: limit,
    });

    for (const event of pending) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.publish(event);
        event.status = 'published';
        event.publishedAt = new Date();
        // eslint-disable-next-line no-await-in-loop
        await this.events.save(event);
      } catch (error) {
        event.attempts += 1;
        if (event.attempts >= MAX_ATTEMPTS) {
          event.status = 'failed';
          this.logger.error(
            `DomainEvent ${event.id} (${event.type}) failed after ${event.attempts} attempts`,
            error instanceof Error ? error.stack : undefined,
          );
        }
        // eslint-disable-next-line no-await-in-loop
        await this.events.save(event);
      }
    }
  }

  /**
   * Deliver a single domain event.
   *
   * Fans the event out to every ACTIVE {@link DeliveryDestination}. Any rejection
   * bubbles so the relay retries (and, with multiple destinations, re-sends to
   * ALL of them — see the class doc on mandatory consumer-side dedupe). Override
   * to change delivery behavior. When no destination is active (empty
   * EVENTS_DESTINATION), this throws so the misconfiguration surfaces.
   */
  async publish(event: DomainEvent): Promise<void> {
    if (this.destinations?.length) {
      await Promise.all(this.destinations.map((d) => d.send(event)));
      return;
    }
    throw new Error(
      'DomainEventRelay.publish() has no active destinations — set ' +
        'EVENTS_DESTINATION (comma-separated) or override publish()',
    );
  }
}
