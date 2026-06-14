import {
  buildDestinations,
  WebhookDestination,
  KafkaDestination,
  SqsDestination,
  EventBridgeDestination,
} from './index';

describe('buildDestinations', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('returns empty list when EVENTS_DESTINATION is unset', () => {
    delete process.env.EVENTS_DESTINATION;
    expect(buildDestinations()).toEqual([]);
  });

  it('selects the webhook adapter', () => {
    process.env.EVENTS_DESTINATION = 'webhook';
    const [d] = buildDestinations();
    expect(d).toBeInstanceOf(WebhookDestination);
    expect(d.name).toBe('webhook');
  });

  it('selects all four adapters and trims whitespace', () => {
    process.env.EVENTS_DESTINATION = 'webhook, kafka ,sqs,eventbridge';
    const ds = buildDestinations();
    expect(ds).toHaveLength(4);
    expect(ds[0]).toBeInstanceOf(WebhookDestination);
    expect(ds[1]).toBeInstanceOf(KafkaDestination);
    expect(ds[2]).toBeInstanceOf(SqsDestination);
    expect(ds[3]).toBeInstanceOf(EventBridgeDestination);
  });

  it('throws on an unknown destination name', () => {
    process.env.EVENTS_DESTINATION = 'webhook,carrier-pigeon';
    expect(() => buildDestinations()).toThrow(/carrier-pigeon/);
    expect(() => buildDestinations()).toThrow(/not a known destination/);
  });
});

