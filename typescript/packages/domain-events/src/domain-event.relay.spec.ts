import { Repository } from 'typeorm';
import {
  DomainEventRelay,
  MAX_ATTEMPTS,
} from './domain-event.relay';
import { DomainEvent } from './domain-event.entity';
import { DeliveryDestination } from './destinations';

function makeEvent(over: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'evt',
    type: 'product.created',
    payload: {},
    status: 'pending',
    attempts: 0,
    created_at: new Date(),
    publishedAt: null,
    ...over,
  };
}

function mockRepo(pending: DomainEvent[]): {
  repo: Repository<DomainEvent>;
  saved: DomainEvent[];
} {
  const saved: DomainEvent[] = [];
  const repo = {
    find: jest.fn().mockResolvedValue(pending),
    save: jest.fn(async (e: DomainEvent) => {
      saved.push({ ...e });
      return e;
    }),
  } as unknown as Repository<DomainEvent>;
  return { repo, saved };
}

describe('DomainEventRelay.processPending', () => {
  it('marks an event published on successful delivery', async () => {
    const event = makeEvent();
    const { repo } = mockRepo([event]);
    const dest: DeliveryDestination = {
      name: 'ok',
      send: jest.fn().mockResolvedValue(undefined),
    };
    const relay = new DomainEventRelay(repo, [dest]);

    await relay.processPending();

    expect(dest.send).toHaveBeenCalledWith(event);
    expect(event.status).toBe('published');
    expect(event.publishedAt).toBeInstanceOf(Date);
  });

  it('increments attempts but stays pending below MAX_ATTEMPTS', async () => {
    const event = makeEvent({ attempts: 0 });
    const { repo } = mockRepo([event]);
    const dest: DeliveryDestination = {
      name: 'bad',
      send: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const relay = new DomainEventRelay(repo, [dest]);

    await relay.processPending();

    expect(event.attempts).toBe(1);
    expect(event.status).toBe('pending');
    expect(event.publishedAt).toBeNull();
  });

  it('marks an event failed once attempts reach MAX_ATTEMPTS', async () => {
    const event = makeEvent({ attempts: MAX_ATTEMPTS - 1 });
    const { repo } = mockRepo([event]);
    const dest: DeliveryDestination = {
      name: 'bad',
      send: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const relay = new DomainEventRelay(repo, [dest]);

    await relay.processPending();

    expect(event.attempts).toBe(MAX_ATTEMPTS);
    expect(event.status).toBe('failed');
  });

  it('fans out to every active destination', async () => {
    const event = makeEvent();
    const { repo } = mockRepo([event]);
    const a: DeliveryDestination = { name: 'a', send: jest.fn().mockResolvedValue(undefined) };
    const b: DeliveryDestination = { name: 'b', send: jest.fn().mockResolvedValue(undefined) };
    const relay = new DomainEventRelay(repo, [a, b]);

    await relay.processPending();

    expect(a.send).toHaveBeenCalledWith(event);
    expect(b.send).toHaveBeenCalledWith(event);
    expect(event.status).toBe('published');
  });

  it('throws (via retry path) when no destinations are configured', async () => {
    const event = makeEvent();
    const { repo } = mockRepo([event]);
    const relay = new DomainEventRelay(repo, []);

    await relay.processPending();

    // publish() throws → handled as a delivery failure
    expect(event.attempts).toBe(1);
    expect(event.status).toBe('pending');
  });
});

describe('DomainEventRelay self-contained poller', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts an interval on bootstrap and clears it on destroy', async () => {
    const { repo } = mockRepo([]);
    const dest: DeliveryDestination = { name: 'ok', send: jest.fn() };
    const relay = new DomainEventRelay(repo, [dest], 1000);
    const processSpy = jest.spyOn(relay, 'processPending').mockResolvedValue();

    relay.onApplicationBootstrap();
    expect(processSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(processSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(processSpy).toHaveBeenCalledTimes(2);

    relay.onModuleDestroy();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(processSpy).toHaveBeenCalledTimes(2);
  });

  it('bootstrap is idempotent (no duplicate timers)', async () => {
    const { repo } = mockRepo([]);
    const relay = new DomainEventRelay(repo, [], 1000);
    const processSpy = jest.spyOn(relay, 'processPending').mockResolvedValue();

    relay.onApplicationBootstrap();
    relay.onApplicationBootstrap();

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(processSpy).toHaveBeenCalledTimes(1);
    relay.onModuleDestroy();
  });
});
