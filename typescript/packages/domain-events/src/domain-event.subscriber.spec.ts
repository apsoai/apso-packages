import { EntityManager, InsertEvent } from 'typeorm';
import { DomainEventSubscriber } from './domain-event.subscriber';
import { DomainEvent } from './domain-event.entity';
import { DefaultDomainEventMapper } from './domain-event.mapper';

class Product {
  id!: number;
}
class Ignored {
  id!: number;
}

function makeManager(): {
  manager: EntityManager;
  created: unknown[];
  saved: unknown[];
} {
  const created: unknown[] = [];
  const saved: unknown[] = [];
  const repo = {
    create: jest.fn((v: unknown) => {
      created.push(v);
      return v;
    }),
    save: jest.fn(async (v: unknown) => {
      saved.push(v);
      return v;
    }),
  };
  const manager = {
    getRepository: jest.fn(() => repo),
  } as unknown as EntityManager;
  return { manager, created, saved };
}

function insertEvent(
  // eslint-disable-next-line @typescript-eslint/ban-types
  target: Function,
  entity: unknown,
  manager: EntityManager,
): InsertEvent<unknown> {
  return {
    metadata: { target },
    entity,
    manager,
  } as unknown as InsertEvent<unknown>;
}

describe('DomainEventSubscriber', () => {
  const mapper = new DefaultDomainEventMapper();

  it('emits a pending DomainEvent for an opted-in entity via event.manager', async () => {
    const { manager, created, saved } = makeManager();
    const sub = new DomainEventSubscriber(mapper, [Product]);

    await sub.afterInsert(insertEvent(Product, { id: 1 }, manager));

    expect(manager.getRepository).toHaveBeenCalledWith(DomainEvent);
    expect(created).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'product.created',
      status: 'pending',
      attempts: 0,
      payload: { id: 1 },
    });
  });

  it('skips entities that are not opted in', async () => {
    const { manager, saved } = makeManager();
    const sub = new DomainEventSubscriber(mapper, [Product]);

    await sub.afterInsert(insertEvent(Ignored, { id: 9 }, manager));

    expect(saved).toHaveLength(0);
  });

  it('recursion guard: never emits for DomainEvent itself', async () => {
    const { manager, saved } = makeManager();
    // Even if DomainEvent were mistakenly opted in, it must be skipped.
    const sub = new DomainEventSubscriber(mapper, [DomainEvent, Product]);

    await sub.afterInsert(insertEvent(DomainEvent, { id: 'x' }, manager));

    expect(saved).toHaveLength(0);
  });

  it('matches opted-in entities by class name string too', async () => {
    const { manager, saved } = makeManager();
    const sub = new DomainEventSubscriber(mapper, [Product]);

    await sub.afterInsert(
      insertEvent('Product' as unknown as () => void, { id: 2 }, manager),
    );

    expect(saved).toHaveLength(1);
  });
});
