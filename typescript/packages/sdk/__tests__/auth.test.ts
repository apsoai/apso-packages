import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createClient, ApsoClientFactory, ApsoAuthError } from '../src/apsoClient';

const baseURL = 'https://api.test';
let calls: { url: string; init: any }[];

function mockFetch(body: unknown = {}, status = 200, resHeaders: Record<string, string> = {}) {
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: '',
      headers: { get: (k: string) => resHeaders[k.toLowerCase()] ?? null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  });
}
const sent = (i = calls.length - 1) => calls[i].init.headers as Record<string, string>;

beforeEach(() => {
  ApsoClientFactory.clearClients();
  calls = [];
  mockFetch();
});

describe('credentials', () => {
  it('apiKey only sends x-api-key and no Authorization', async () => {
    await createClient({ baseURL, apiKey: 'k' }).get('/posts');
    expect(sent()['x-api-key']).toBe('k');
    expect(sent().Authorization).toBeUndefined();
  });

  it('accessToken only lists and creates with a Bearer token and no key', async () => {
    const apso = createClient({ baseURL, accessToken: 'user-token' });
    await apso.get('/posts');
    await apso.post('/posts', { title: 'a' });
    await apso.from('posts').select('*');
    for (const i of [0, 1, 2]) {
      expect(sent(i).Authorization).toBe('Bearer user-token');
      expect('x-api-key' in sent(i)).toBe(false);
    }
  });

  it('calls a token function on every request and uses a changed token', async () => {
    let token = 't1';
    const accessToken = jest.fn(async () => token);
    const apso = createClient({ baseURL, accessToken });
    await apso.get('/posts');
    token = 't2';
    await apso.get('/posts');
    expect(accessToken).toHaveBeenCalledTimes(2);
    expect(sent(0).Authorization).toBe('Bearer t1');
    expect(sent(1).Authorization).toBe('Bearer t2');
  });

  it('does not throw with neither credential', async () => {
    await createClient({ baseURL }).get('/posts');
    expect(sent()['x-api-key']).toBeUndefined();
    expect(sent().Authorization).toBeUndefined();
  });
});

describe('client cache', () => {
  it('two different tokens never share a client', async () => {
    const a = createClient({ baseURL, accessToken: 'alice' });
    const b = createClient({ baseURL, accessToken: 'bob' });
    expect(a).not.toBe(b);
    await a.get('/me');
    await b.get('/me');
    expect(sent(0).Authorization).toBe('Bearer alice');
    expect(sent(1).Authorization).toBe('Bearer bob');
  });

  it('two clients with different custom headers never share a client', () => {
    const a = createClient({ baseURL, apiKey: 'k', headers: { Authorization: 'Bearer alice' } });
    const b = createClient({ baseURL, apiKey: 'k', headers: { Authorization: 'Bearer bob' } });
    expect(a).not.toBe(b);
  });

  it('still reuses a key-only client', () => {
    expect(createClient({ baseURL, apiKey: 'k' })).toBe(createClient({ baseURL, apiKey: 'k' }));
    expect(createClient({ baseURL, apiKey: 'k' })).not.toBe(createClient({ baseURL, apiKey: 'other' }));
  });

  it('does not serve cached rows across users of a token function', async () => {
    let token = 'alice';
    const apso = createClient({ baseURL, accessToken: () => token });
    await apso.get('/me', undefined, true);
    token = 'bob';
    await apso.get('/me', undefined, true);
    expect(calls).toHaveLength(2);
    expect(sent(1).Authorization).toBe('Bearer bob');
  });
});

describe('x-request-id', () => {
  it('is generated per request', async () => {
    const apso = createClient({ baseURL, apiKey: 'k' });
    await apso.get('/posts');
    await apso.get('/posts');
    expect(sent(0)['x-request-id']).toBeTruthy();
    expect(sent(0)['x-request-id']).not.toBe(sent(1)['x-request-id']);
  });

  it("keeps the caller's id, whatever its case", async () => {
    await createClient({ baseURL, headers: { 'X-Request-Id': 'mine' } }).get('/posts');
    expect(sent()['X-Request-Id']).toBe('mine');
    expect(sent()['x-request-id']).toBeUndefined();
  });
});

describe('401 and 403', () => {
  it('fetch: throws ApsoAuthError with the service message and response request id', async () => {
    mockFetch({ statusCode: 403, message: 'Missing role: admin' }, 403, { 'x-request-id': 'req-1' });
    const err = await createClient({ baseURL, accessToken: 't' }).get('/posts').catch(e => e);
    expect(err).toBeInstanceOf(ApsoAuthError);
    expect(err).toMatchObject({ status: 403, message: 'Missing role: admin', requestId: 'req-1' });
  });

  it('fetch: falls back to the id it sent when the response has none', async () => {
    mockFetch({ message: 'Unauthorized' }, 401);
    const err = await createClient({ baseURL, accessToken: 't' }).get('/posts').catch(e => e);
    expect(err).toMatchObject({ status: 401, message: 'Unauthorized', requestId: sent()['x-request-id'] });
  });

  it('axios: throws ApsoAuthError with the service message and request id', async () => {
    const mock = new MockAdapter(axios);
    mock.onGet('/posts').reply(401, { message: 'Token expired' }, { 'x-request-id': 'req-2' });
    const err = await createClient({ baseURL, accessToken: 't', client: 'axios' }).get('/posts').catch(e => e);
    mock.restore();
    expect(err).toBeInstanceOf(ApsoAuthError);
    expect(err).toMatchObject({ status: 401, message: 'Token expired', requestId: 'req-2' });
  });

  it('axios: sends the token and a request id', async () => {
    const mock = new MockAdapter(axios);
    mock.onGet('/posts').reply(200, []);
    await createClient({ baseURL, accessToken: 't', client: 'axios' }).get('/posts');
    const h = mock.history.get[0].headers!;
    mock.restore();
    expect(h.Authorization).toBe('Bearer t');
    expect(h['x-request-id']).toBeTruthy();
    expect(h['x-api-key']).toBeUndefined();
  });

  it('from(): returns the request id on the error and does not throw', async () => {
    mockFetch({ message: 'Unauthorized' }, 401, { 'x-request-id': 'req-3' });
    const { error, status } = await createClient({ baseURL, accessToken: 't' }).from('posts').select('*');
    expect(status).toBe(401);
    expect(error).toMatchObject({ message: 'Unauthorized', requestId: 'req-3' });
  });

  it('other statuses keep the 1.4.0 error', async () => {
    mockFetch({}, 500);
    await expect(createClient({ baseURL, apiKey: 'k' }).get('/posts')).rejects.toThrow('HTTP error! status: 500');
  });
});

describe('browser warning', () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  afterEach(() => {
    delete (global as any).window;
    warn.mockClear();
  });

  it('warns when apiKey is set in a browser', () => {
    (global as any).window = {};
    createClient({ baseURL, apiKey: 'k' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('server-side secret'));
  });

  it('is silent in a browser with accessToken, and on a server with apiKey', () => {
    createClient({ baseURL, apiKey: 'k' });
    (global as any).window = {};
    createClient({ baseURL, accessToken: 't' });
    expect(warn).not.toHaveBeenCalled();
  });
});
