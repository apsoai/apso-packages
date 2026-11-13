import 'reflect-metadata';
import { AddressInfo } from 'net';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ApiOperation, ApiProperty, ApiQuery, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_AUTH, MCP_INTERNAL_AUTH, McpAuth, McpTool, mountMcp, toolsFromDocument } from './index';

class PublishDto {
  @ApiProperty()
  title!: string;
}

@Controller('notes')
class NotesController {
  @Get()
  @ApiQuery({ name: 'q', required: false })
  @McpTool({ name: 'list_notes', description: 'List notes, optionally matching q' })
  list(@Query('q') q?: string) {
    return [{ id: '1', q: q ?? null }];
  }

  @Post(':id/publish')
  @McpTool({ name: 'publish_note' })
  publish(@Param('id') id: string, @Body() dto: PublishDto, @Req() req: any) {
    return { id, title: dto.title, user: req.user, mcp: req.apso?.mcp };
  }

  @Get('hidden')
  hidden() {
    return 'not a tool';
  }
}

// Documented the way @apso/crud documents a PostgREST-only list route: one
// parameter per column and an exploded object for filters on embedded rows.
@Controller('posts')
class PostsController {
  @Get()
  @ApiOperation({ summary: 'Get many Post', description: 'Filter with one parameter per column, value op.value.' })
  @ApiQuery({ name: 'select', required: false, schema: { type: 'string' } })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer' } })
  @ApiQuery({ name: 'views', required: false, description: 'Filter, op.value: gte.5', schema: { type: 'string' } })
  @ApiQuery({
    name: 'embedded',
    required: false,
    style: 'form',
    explode: true,
    schema: { type: 'object', additionalProperties: { type: 'string' } },
  } as any)
  @McpTool({ name: 'list_posts' })
  list(@Req() req: any, @Res({ passthrough: true }) res: any) {
    if (req.query.limit === undefined) {
      res.status(206);
      res.setHeader('Content-Range', '0-4/6');
    }
    return [{ url: req.url, query: req.query }];
  }
}

// Stands in for the app's real auth guard: the tool call must go through it.
class TokenGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.headers.authorization !== 'Bearer good') throw new UnauthorizedException();
    req.user = 'ada';
    return true;
  }
}

@Module({ controllers: [NotesController, PostsController], providers: [{ provide: APP_GUARD, useClass: TokenGuard }] })
class AppModule {}

describe('@apso/mcp', () => {
  let app: INestApplication;
  let url: URL;

  beforeAll(async () => {
    process.env.ALLOWED_ORIGINS = 'https://app.example, https://admin.example';
    app = await NestFactory.create(AppModule, { logger: false });
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('notes').build());
    mountMcp(app, document);
    await app.listen(0);
    url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/mcp`);
  });
  afterAll(async () => {
    delete process.env.ALLOWED_ORIGINS;
    await app.close();
  });

  const connect = async (token?: string) => {
    const client = new Client({ name: 'test', version: '1' });
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } }));
    return client;
  };

  test('lists only the marked routes, with schemas from the route', async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['list_notes', 'list_posts', 'publish_note']);
    const publish = tools.find((tool) => tool.name === 'publish_note')!;
    expect(publish.inputSchema.required).toEqual(['id', 'body']);
    expect((publish.inputSchema.properties as any).body.properties.title.type).toBe('string');
    expect(tools.find((tool) => tool.name === 'list_notes')!.annotations?.readOnlyHint).toBe(true);
  });

  test('a call runs through the app guards as the caller', async () => {
    const args = { name: 'publish_note', arguments: { id: '7', body: { title: 'Hello' } } };
    const denied: any = await (await connect()).callTool(args);
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain('401');

    const ok: any = await (await connect('good')).callTool(args);
    expect(ok.isError).toBeFalsy();
    expect(JSON.parse(ok.content[0].text)).toEqual({ id: '7', title: 'Hello', user: 'ada', mcp: { tool: 'publish_note' } });
  });

  test('a REST caller cannot pass as an MCP call with a header or a body field', async () => {
    const res = await fetch(new URL('/notes/7/publish', url), {
      method: 'POST',
      headers: {
        authorization: 'Bearer good',
        'content-type': 'application/json',
        apso: JSON.stringify({ mcp: { tool: 'publish_note' } }),
        'x-apso-mcp': 'publish_note',
      },
      body: JSON.stringify({ title: 'Hello', apso: { mcp: { tool: 'publish_note' } } }),
    });
    expect(await res.json()).toEqual({ id: '7', title: 'Hello', user: 'ada' });
  });

  test('browser origins follow ALLOWED_ORIGINS and nothing wider', async () => {
    const list = (origin: string) =>
      fetch(url, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
    const allowed = await list('https://admin.example');
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://admin.example');

    const other = await list('https://evil.example');
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('query arguments reach the route', async () => {
    const result: any = await (await connect('good')).callTool({ name: 'list_notes', arguments: { q: 'a b' } });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: '1', q: 'a b' }]);
  });

  test('a column filter and an embedded filter reach the route as PostgREST query parameters', async () => {
    const client = await connect('good');
    const tool = (await client.listTools()).tools.find((candidate) => candidate.name === 'list_posts')!;
    expect(tool.description).toBe('Get many Post. Filter with one parameter per column, value op.value.');
    expect((tool.inputSchema.properties as any).views).toEqual({ type: 'string', description: 'Filter, op.value: gte.5' });
    expect((tool.inputSchema.properties as any).embedded).toEqual({ type: 'object', additionalProperties: { type: 'string' } });

    const result: any = await client.callTool({
      name: 'list_posts',
      arguments: { select: 'id,comments!inner(id)', views: 'gte.100', embedded: { 'comments.likes': 'gt.5' }, limit: 2, unknown: 'dropped' },
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)[0].query).toEqual({
      select: 'id,comments!inner(id)',
      views: 'gte.100',
      'comments.likes': 'gt.5',
      limit: '2',
    });
  });

  test('a 206 with Content-Range tells the model the result is partial', async () => {
    const result: any = await (await connect('good')).callTool({ name: 'list_posts', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.content[1].text).toBe('Partial result: rows 0-4 of 6. Send limit and offset for the rest.');
  });

  test('an untyped body and a duplicate name are boot errors', () => {
    const operation = (extra: object = {}) => ({ 'x-apso-mcp': { name: 'do_it' }, responses: {}, ...extra });
    const untyped: any = {
      paths: { '/a': { post: operation({ requestBody: { content: { 'application/json': { schema: { type: 'object' } } } } }) } },
    };
    expect(() => toolsFromDocument(untyped)).toThrow('the body has no schema');
    const twice: any = { paths: { '/a': { get: operation() }, '/b': { get: operation() } } };
    expect(() => toolsFromDocument(twice)).toThrow('already named "do_it"');
  });
});

describe('@apso/mcp with OAuth sign-in', () => {
  let app: INestApplication;
  let base: string;

  // The app's own token check, shared with MCP through the MCP_AUTH provider.
  const auth: McpAuth = {
    authorizationServers: ['https://login.example.com/'],
    verify: async (req) => {
      if (req.headers.authorization !== 'Bearer good') throw new UnauthorizedException();
      return { clientId: 'claude-web' };
    },
  };
  const ORIGIN = 'https://agent.example';

  @Module({
    controllers: [NotesController],
    providers: [
      { provide: APP_GUARD, useClass: TokenGuard },
      { provide: MCP_AUTH, useValue: auth },
    ],
  })
  class OAuthAppModule {}

  beforeAll(async () => {
    app = await NestFactory.create(OAuthAppModule, { logger: false });
    mountMcp(app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('notes').build()), {
      allowedOrigins: [ORIGIN],
    });
    await app.listen(0);
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(() => app.close());

  const post = (headers: Record<string, string> = {}) =>
    fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });

  test('no token gets the 401 that points at the sign-in metadata', async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
    );
    const bad = await post({ authorization: 'Bearer expired' });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  test('the metadata names the identity provider, at the path and root forms', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await fetch(base + path);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        resource: `${base}/mcp`,
        authorization_servers: ['https://login.example.com/'],
        bearer_methods_supported: ['header'],
      });
    }
  });

  test('a valid token lists and calls tools', async () => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: 'Bearer good' } } }),
    );
    expect((await client.listTools()).tools).toHaveLength(2);
    const result: any = await client.callTool({ name: 'list_notes', arguments: {} });
    expect(result.isError).toBeFalsy();
  });

  test('the tool call names the client application the token was issued to', async () => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: 'Bearer good' } } }),
    );
    const result: any = await client.callTool({ name: 'publish_note', arguments: { id: '7', body: { title: 'Hello' } } });
    expect(JSON.parse(result.content[0].text).mcp).toEqual({ tool: 'publish_note', clientId: 'claude-web' });
  });

  test('a browser preflight from an allowed origin is answered', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,mcp-protocol-version',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-allow-methods')).toBe('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('authorization,content-type,mcp-protocol-version');

    const other = await fetch(`${base}/mcp`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(other.status).toBe(403);
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('a browser client can read the 401 challenge', async () => {
    const res = await post({ origin: ORIGIN });
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(res.headers.get('access-control-expose-headers')!.split(', ')).toEqual(
      expect.arrayContaining(['WWW-Authenticate', 'Mcp-Session-Id']),
    );
  });

  test('a browser client on an allowed origin completes initialize, list and call', async () => {
    // Stands in for the browser: every response must be readable from ORIGIN.
    const seen: Array<string | null> = [];
    const browserFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      seen.push(res.headers.get('access-control-allow-origin'));
      return res;
    };
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        fetch: browserFetch,
        requestInit: { headers: { authorization: 'Bearer good', origin: ORIGIN } },
      }),
    );
    expect((await client.listTools()).tools).toHaveLength(2);
    const result: any = await client.callTool({ name: 'list_notes', arguments: {} });
    expect(result.isError).toBeFalsy();
    // initialize, the initialized notification, tools/list and tools/call at least.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((value) => value === ORIGIN)).toBe(true);
  });
});

describe('@apso/mcp behind an adapter that already read the body', () => {
  test('lists and calls tools when the request body is a Buffer on req.body', async () => {
    const app = await NestFactory.create(AppModule, { logger: false });
    // What a Lambda adapter does: the stream is spent and the body sits on req.body.
    app.use('/mcp', (req: any, _res: any, next: () => void) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        req.body = Buffer.concat(chunks);
        next();
      });
    });
    mountMcp(app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('notes').build()));
    await app.listen(0);
    try {
      const url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/mcp`);
      const client = new Client({ name: 'test', version: '1' });
      await client.connect(new StreamableHTTPClientTransport(url));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain('list_notes');
    } finally {
      await app.close();
    }
  });
});

// One address per audience: /mcp takes a user's token, /mcp/internal a service key.
describe('@apso/mcp with an internal and an external address', () => {
  // Stands in for an app whose guard lets a key or a user's token through and says which it saw.
  @Controller('whoami')
  class WhoController {
    @Get()
    @McpTool({ name: 'who' })
    who(@Req() req: any) {
      return { key: req.headers['x-api-key'] ?? null, authorization: req.headers.authorization ?? null };
    }
  }

  const user: McpAuth = {
    authorizationServers: ['https://login.example.com/'],
    ignoredHeaders: ['X-Api-Key'],
    verify: async (req) => {
      if (req.headers.authorization !== 'Bearer good') throw new UnauthorizedException();
    },
  };
  const service = (authorizationServers: string[]): McpAuth => ({
    authorizationServers,
    ignoredHeaders: ['authorization'],
    verify: async (req) => {
      if (req.headers['x-api-key'] !== 'sk_good') throw new UnauthorizedException();
    },
  });

  const boot = async (providers: any[]) => {
    @Module({ controllers: [WhoController], providers })
    class TwoAddressModule {}
    const app = await NestFactory.create(TwoAddressModule, { logger: false });
    mountMcp(app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('who').build()));
    await app.listen(0);
    return { app, base: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}` };
  };
  const post = (url: string, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
  const who = async (url: string, headers: Record<string, string>) => {
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
    const result: any = await client.callTool({ name: 'who', arguments: {} });
    return JSON.parse(result.content[0].text);
  };

  test('each address runs its own check and has its own sign-in metadata', async () => {
    const { app, base } = await boot([
      { provide: MCP_AUTH, useValue: user },
      { provide: MCP_INTERNAL_AUTH, useValue: service(['https://app.example.com']) },
    ]);
    try {
      // External: a user's token only. A key is not a credential there.
      expect((await post(`${base}/mcp`, { 'x-api-key': 'sk_good' })).status).toBe(401);
      const anonymous = await post(`${base}/mcp`);
      expect(anonymous.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
      // The key next to a valid token is not passed on to the route.
      expect(await who(`${base}/mcp`, { authorization: 'Bearer good', 'x-api-key': 'sk_good' })).toEqual({ key: null, authorization: 'Bearer good' });

      // Internal: the key only. A user's token is not a credential there.
      expect((await post(`${base}/mcp/internal`, { authorization: 'Bearer good' })).status).toBe(401);
      const refused = await post(`${base}/mcp/internal`);
      expect(refused.status).toBe(401);
      expect(refused.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/internal"`);
      expect(await who(`${base}/mcp/internal`, { authorization: 'Bearer good', 'x-api-key': 'sk_good' })).toEqual({ key: 'sk_good', authorization: null });

      const metadata = async (path: string) => (await fetch(`${base}/.well-known/oauth-protected-resource${path}`)).json();
      const externalMetadata = { resource: `${base}/mcp`, authorization_servers: ['https://login.example.com/'], bearer_methods_supported: ['header'] };
      expect(await metadata('/mcp')).toEqual(externalMetadata);
      expect(await metadata('')).toEqual(externalMetadata);
      expect(await metadata('/mcp/internal')).toEqual({
        resource: `${base}/mcp/internal`,
        authorization_servers: ['https://app.example.com'],
        bearer_methods_supported: ['header'],
      });
    } finally {
      await app.close();
    }
  });

  test('with only the internal check, /mcp is not served and a refusal names no sign-in', async () => {
    const { app, base } = await boot([{ provide: MCP_INTERNAL_AUTH, useValue: service([]) }]);
    try {
      expect((await post(`${base}/mcp`)).status).toBe(404);
      expect((await post(`${base}/mcp`, { 'x-api-key': 'sk_good' })).status).toBe(404);
      const refused = await post(`${base}/mcp/internal`);
      expect(refused.status).toBe(401);
      expect(refused.headers.get('www-authenticate')).toBeNull();
      expect((await post(`${base}/mcp/internal`, { 'x-api-key': 'sk_good' })).status).toBe(200);
      for (const path of ['', '/mcp', '/mcp/internal'])
        expect((await fetch(`${base}/.well-known/oauth-protected-resource${path}`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });

  test('the internal address is described without sign-in on the external one', async () => {
    const { app, base } = await boot([{ provide: MCP_INTERNAL_AUTH, useValue: { ...service(['https://app.example.com']), resource: 'https://api.example.com/mcp/internal' } }]);
    try {
      const refused = await post(`${base}/mcp/internal`, { authorization: 'Bearer expired' });
      expect(refused.headers.get('www-authenticate')).toBe(
        'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp/internal", error="invalid_token"',
      );
      const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp/internal`);
      expect(await res.json()).toEqual({
        resource: 'https://api.example.com/mcp/internal',
        authorization_servers: ['https://app.example.com'],
        bearer_methods_supported: ['header'],
      });
      expect((await fetch(`${base}/.well-known/oauth-protected-resource`)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
