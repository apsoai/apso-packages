import { DynamicModule, Global, Module, Provider, Type } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DomainEvent } from './domain-event.entity';
import {
  DomainEventSubscriber,
  DOMAIN_EVENT_ENTITIES,
} from './domain-event.subscriber';
import {
  DomainEventRelay,
  DOMAIN_EVENT_POLL_INTERVAL,
  DEFAULT_POLL_INTERVAL_MS,
} from './domain-event.relay';
import {
  DOMAIN_EVENT_MAPPER,
  DefaultDomainEventMapper,
  DomainEventMapper,
} from './domain-event.mapper';
import { DOMAIN_EVENT_DESTINATIONS, buildDestinations } from './destinations';

/**
 * Options for {@link DomainEventsModule.forRoot}.
 */
export interface DomainEventsModuleOptions {
  /**
   * Entity classes opted in to domain-event emission (the CLI-emitted
   * manifest). Only state changes to these emit events; the library never
   * hardcodes this set.
   */
  // eslint-disable-next-line @typescript-eslint/ban-types
  entities: Function[];

  /**
   * Optional custom mapper class to bind under {@link DOMAIN_EVENT_MAPPER}.
   * Defaults to {@link DefaultDomainEventMapper}.
   */
  mapper?: Type<DomainEventMapper>;

  /**
   * Poll interval (ms) for the relay's self-contained drain loop. Defaults to
   * {@link DEFAULT_POLL_INTERVAL_MS} (5000).
   */
  pollIntervalMs?: number;
}

/**
 * DomainEventsModule wires the durable domain-event spine (transactional-outbox
 * pattern, surfaced as generic domain events).
 *
 * - {@link DomainEventSubscriber} writes events in-transaction with state changes.
 * - {@link DomainEventRelay} drains and delivers pending events, with its own
 *   self-contained poller (no external scheduler dependency).
 * - {@link DOMAIN_EVENT_MAPPER} controls event-type/payload semantics; pass a
 *   `mapper` to override.
 * - {@link DOMAIN_EVENT_DESTINATIONS} is the set of ACTIVE delivery adapters,
 *   built from the `EVENTS_DESTINATION` env var at runtime.
 *
 * MULTI-DATASOURCE: `@EventSubscriber()` auto-registers on the default
 * DataSource; for additional named DataSources, register this module (or the
 * subscriber) per DataSource.
 */
@Global()
@Module({})
export class DomainEventsModule {
  static forRoot(options: DomainEventsModuleOptions): DynamicModule {
    const mapperProvider: Provider = options.mapper
      ? { provide: DOMAIN_EVENT_MAPPER, useClass: options.mapper }
      : { provide: DOMAIN_EVENT_MAPPER, useClass: DefaultDomainEventMapper };

    const providers: Provider[] = [
      DomainEventSubscriber,
      DomainEventRelay,
      mapperProvider,
      {
        provide: DOMAIN_EVENT_ENTITIES,
        useValue: options.entities ?? [],
      },
      {
        provide: DOMAIN_EVENT_POLL_INTERVAL,
        useValue: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      },
      {
        provide: DOMAIN_EVENT_DESTINATIONS,
        useFactory: () => buildDestinations(),
      },
    ];

    return {
      module: DomainEventsModule,
      imports: [TypeOrmModule.forFeature([DomainEvent])],
      providers,
      exports: [
        DomainEventRelay,
        DOMAIN_EVENT_MAPPER,
        DOMAIN_EVENT_DESTINATIONS,
        DOMAIN_EVENT_ENTITIES,
      ],
    };
  }
}
