import { signWebhook, WebhookDestination } from './webhook.destination';
import { DomainEvent } from '../domain-event.entity';

describe('signWebhook', () => {
  // CONTRACT.md §6 — official Standard Webhooks test vector. MANDATORY.
  it('matches the official Standard Webhooks vector', () => {
    const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
    const timestamp = 1614265330;
    const payload = '{"test": 2432232314}';
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

    const sig = signWebhook(id, timestamp, payload, secret);

    expect(sig).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('is deterministic for identical inputs', () => {
    const a = signWebhook('id', 100, '{"a":1}', 'whsec_dGVzdHNlY3JldA==');
    const b = signWebhook('id', 100, '{"a":1}', 'whsec_dGVzdHNlY3JldA==');
    expect(a).toBe(b);
    expect(a.startsWith('v1,')).toBe(true);
  });

  it('changes when any input changes', () => {
    const base = signWebhook('id', 100, '{"a":1}', 'whsec_dGVzdHNlY3JldA==');
    expect(signWebhook('id2', 100, '{"a":1}', 'whsec_dGVzdHNlY3JldA==')).not.toBe(
      base,
    );
    expect(signWebhook('id', 101, '{"a":1}', 'whsec_dGVzdHNlY3JldA==')).not.toBe(
      base,
    );
    expect(signWebhook('id', 100, '{"a":2}', 'whsec_dGVzdHNlY3JldA==')).not.toBe(
      base,
    );
  });
});

describe('WebhookDestination', () => {
  const OLD_ENV = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    fetchMock = jest.fn();
    (global as unknown as { fetch: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  const event: DomainEvent = {
    id: 'evt-1',
    type: 'product.created',
    payload: { sku: 'abc' },
    status: 'pending',
    attempts: 0,
    created_at: new Date(),
    publishedAt: null,
  };

  it('throws when URL is not set', async () => {
    delete process.env.EVENTS_WEBHOOK_URL;
    process.env.EVENTS_WEBHOOK_SECRET = 'whsec_dGVzdA==';
    await expect(new WebhookDestination().send(event)).rejects.toThrow(
      'EVENTS_WEBHOOK_URL is not set',
    );
  });

  it('throws when secret is not set', async () => {
    process.env.EVENTS_WEBHOOK_URL = 'https://example.com/hook';
    delete process.env.EVENTS_WEBHOOK_SECRET;
    await expect(new WebhookDestination().send(event)).rejects.toThrow(
      'EVENTS_WEBHOOK_SECRET is not set',
    );
  });

  it('POSTs with Standard Webhooks headers and throws on non-2xx', async () => {
    process.env.EVENTS_WEBHOOK_URL = 'https://example.com/hook';
    process.env.EVENTS_WEBHOOK_SECRET = 'whsec_dGVzdA==';
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    await expect(new WebhookDestination().send(event)).rejects.toThrow(
      /status 500/,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(init.headers['webhook-id']).toBe('evt-1');
    expect(init.headers['webhook-signature']).toMatch(/^v1,/);
    expect(typeof init.headers['webhook-timestamp']).toBe('string');
  });

  it('resolves on 2xx', async () => {
    process.env.EVENTS_WEBHOOK_URL = 'https://example.com/hook';
    process.env.EVENTS_WEBHOOK_SECRET = 'whsec_dGVzdA==';
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    await expect(new WebhookDestination().send(event)).resolves.toBeUndefined();
  });
});
