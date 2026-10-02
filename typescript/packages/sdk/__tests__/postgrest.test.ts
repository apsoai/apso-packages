import { createClient, ApsoClientFactory } from '../src/apsoClient';

// Capture the last fetch call and control the response.
let lastCall: { url: string; init: any };
function mockFetch(body: unknown, init: Partial<{ status: number; ok: boolean; headers: Record<string, string> }> = {}) {
  const status = init.status ?? 200;
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  (global as any).fetch = jest.fn(async (url: string, i: any) => {
    lastCall = { url, init: i };
    return {
      ok: init.ok ?? (status >= 200 && status < 300),
      status,
      statusText: '',
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    };
  });
}

const client = () =>
  createClient({ baseURL: 'https://api.test', apiKey: 'k', client: 'fetch' });

beforeEach(() => {
  ApsoClientFactory.clearClients();
  lastCall = undefined as any;
});

const qs = () => decodeURIComponent(new URL(lastCall.url).search);

describe('postgrest from() — query serialization', () => {
  it('GET with the postgrest dialect header and eq filter', async () => {
    mockFetch([{ id: 1 }]);
    const { data, error } = await client().from('posts').select('*').eq('status', 'active');
    expect(lastCall.init.method).toBe('GET');
    expect(new URL(lastCall.url).pathname).toBe('/posts');
    expect(qs()).toBe('?status=eq.active');
    expect(lastCall.init.headers['X-Crud-Dialect']).toBe('postgrest');
    expect(data).toEqual([{ id: 1 }]);
    expect(error).toBeNull();
  });

  it('select columns, comparison ops, in, order, range', async () => {
    mockFetch([]);
    await client()
      .from('posts')
      .select('id,title')
      .gte('views', 10)
      .lt('views', 100)
      .in('id', [1, 2, 3])
      .order('views', { ascending: false })
      .range(0, 9);
    const s = qs();
    expect(s).toContain('select=id,title');
    expect(s).toContain('views=gte.10');
    expect(s).toContain('views=lt.100');
    expect(s).toContain('id=in.(1,2,3)');
    expect(s).toContain('order=views.desc');
    expect(s).toContain('offset=0');
    expect(s).toContain('limit=10');
  });

  it('or() emits an or=(...) group; not() negates', async () => {
    mockFetch([]);
    await client().from('posts').select('*').or('views.eq.100,views.eq.999').not('title', 'eq', 'hidden');
    const s = qs();
    expect(s).toContain('or=(views.eq.100,views.eq.999)');
    expect(s).toContain('title=not.eq.hidden');
  });

  it('is() and match()', async () => {
    mockFetch([]);
    await client().from('u').select('*').is('deleted_at', null).match({ role: 'admin', active: true });
    const s = qs();
    expect(s).toContain('deleted_at=is.null');
    expect(s).toContain('role=eq.admin');
    expect(s).toContain('active=eq.true');
  });
});

describe('postgrest from() — return shaping', () => {
  it('single() returns the object', async () => {
    mockFetch([{ id: 7 }]);
    const { data, error } = await client().from('p').select('*').eq('id', 7).single();
    expect(data).toEqual({ id: 7 });
    expect(error).toBeNull();
  });

  it('single() on 0 rows returns a PGRST116 error, not a throw', async () => {
    mockFetch([]);
    const { data, error } = await client().from('p').select('*').eq('id', 999).single();
    expect(data).toBeNull();
    expect(error?.code).toBe('PGRST116');
  });

  it('maybeSingle() on 0 rows returns data null and no error', async () => {
    mockFetch([]);
    const { data, error } = await client().from('p').select('*').eq('id', 999).maybeSingle();
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('exposes count from the Content-Range header', async () => {
    mockFetch([{ id: 1 }], { headers: { 'content-range': '0-0/42' } });
    const { count } = await client().from('p').select('*', { count: 'exact' });
    expect(count).toBe(42);
    expect(lastCall.init.headers['Prefer']).toContain('count=exact');
  });
});

describe('postgrest from() — mutations', () => {
  it('insert() POSTs the body', async () => {
    mockFetch([{ id: 1, name: 'a' }]);
    await client().from('u').insert({ name: 'a' }).select();
    expect(lastCall.init.method).toBe('POST');
    expect(JSON.parse(lastCall.init.body)).toEqual({ name: 'a' });
    expect(lastCall.init.headers['Prefer']).toContain('return=representation');
  });

  it('update() PATCHes with filters', async () => {
    mockFetch([{ id: 1 }]);
    await client().from('u').update({ name: 'b' }).eq('id', 1);
    expect(lastCall.init.method).toBe('PATCH');
    expect(JSON.parse(lastCall.init.body)).toEqual({ name: 'b' });
    expect(qs()).toContain('id=eq.1');
  });

  it('delete() DELETEs with filters', async () => {
    mockFetch(null, { status: 204 });
    await client().from('u').delete().eq('id', 1);
    expect(lastCall.init.method).toBe('DELETE');
    expect(qs()).toContain('id=eq.1');
  });
});

describe('postgrest from() — errors never throw', () => {
  it('HTTP 400 surfaces on .error', async () => {
    mockFetch({ message: 'bad filter', code: '42703' }, { status: 400, ok: false });
    const { data, error } = await client().from('p').select('*').eq('nope', 1);
    expect(data).toBeNull();
    expect(error?.message).toBe('bad filter');
    expect(error?.code).toBe('42703');
  });

  it('unsupported operators throw a clear error', () => {
    expect(() => client().from('p').select('*').contains('tags', ['a'] as any)).toThrow(/not supported/i);
  });
});
