import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
  RemoveEvent,
} from 'typeorm';
import { DomainEvent } from './domain-event.entity';
import {
  DOMAIN_EVENT_MAPPER,
  DomainEventAction,
  DomainEventMapper,
} from './domain-event.mapper';

/**
 * DI token carrying the set of entity classes that have opted in to
 * domain-event emission. Provided by {@link DomainEventsModule.forRoot} from the
 * `entities` it is given. The library NEVER hardcodes this set — it is the
 * CLI-emitted manifest of opted-in entities.
 */
export const DOMAIN_EVENT_ENTITIES = 'DOMAIN_EVENT_ENTITIES';

/**
 * DomainEventSubscriber writes a {@link DomainEvent} row for every
 * insert/update/remove of an opted-in entity.
 *
 * DURABILITY: each row is written via `event.manager` (the EntityManager of the
 * in-flight transaction), so the event is committed atomically WITH the state
 * change. This is the durability lever behind the transactional-outbox pattern.
 *
 * RECURSION GUARD: we never emit events for {@link DomainEvent} itself, otherwise
 * each emitted row would itself trigger another emission. Only entities in the
 * opted-in set (passed to {@link DomainEventsModule.forRoot}) emit; everything
 * else is skipped.
 */
@Injectable()
@EventSubscriber()
export class DomainEventSubscriber implements EntitySubscriberInterface {
  constructor(
    @Inject(DOMAIN_EVENT_MAPPER) private readonly mapper: DomainEventMapper,
    // eslint-disable-next-line @typescript-eslint/ban-types
    @Inject(DOMAIN_EVENT_ENTITIES) private readonly emittingEntities: Function[],
    // MULTI-DATASOURCE: Nest auto-registers @EventSubscriber() providers on the
    // DEFAULT DataSource. We ALSO push ourselves onto any injected DataSource
    // here so registration is robust for named/non-default DataSources too. For
    // multiple DataSources, register DomainEventsModule per DataSource.
    @Optional() dataSource?: DataSource,
  ) {
    dataSource?.subscribers?.push(this);
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  private isEmitting(target: Function | string): boolean {
    // RECURSION GUARD: never emit for DomainEvent itself.
    if (target === DomainEvent || target === 'DomainEvent') {
      return false;
    }
    return this.emittingEntities.some(
      (cls) => target === cls || target === cls.name,
    );
  }

  private async emit(
    manager: EntityManager,
    // eslint-disable-next-line @typescript-eslint/ban-types
    entityClass: Function,
    entity: unknown,
    action: DomainEventAction,
  ): Promise<void> {
    const entityName = entityClass.name;
    const repo = manager.getRepository(DomainEvent);
    // manager keeps us inside the active transaction.
    await repo.save(
      repo.create({
        type: this.mapper.eventType(entityName, action),
        payload: this.mapper.toPayload(entity, action),
        status: 'pending',
        attempts: 0,
      }),
    );
  }

  async afterInsert(event: InsertEvent<unknown>): Promise<void> {
    if (!this.isEmitting(event.metadata.target)) return;
    await this.emit(
      event.manager,
      // eslint-disable-next-line @typescript-eslint/ban-types
      event.metadata.target as Function,
      event.entity,
      'created',
    );
  }

  async afterUpdate(event: UpdateEvent<unknown>): Promise<void> {
    if (!this.isEmitting(event.metadata.target)) return;
    await this.emit(
      event.manager,
      // eslint-disable-next-line @typescript-eslint/ban-types
      event.metadata.target as Function,
      event.entity ?? event.databaseEntity,
      'updated',
    );
  }

  async afterRemove(event: RemoveEvent<unknown>): Promise<void> {
    if (!this.isEmitting(event.metadata.target)) return;
    await this.emit(
      event.manager,
      // eslint-disable-next-line @typescript-eslint/ban-types
      event.metadata.target as Function,
      event.entity ?? event.databaseEntity,
      'removed',
    );
  }
}
