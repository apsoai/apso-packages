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
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ApiProperty, ApiQuery, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { MCP_AUTH, McpAuth, McpTool, mountMcp, toolsFromDocument } from './index';

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

// Stands in for the app's real auth guard: the tool call must go through it.
class TokenGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.headers.authorization !== 'Bearer good') throw new UnauthorizedException();
    req.user = 'ada';
    return true;
  }
}

@Module({ controllers: [NotesController], providers: [{ provide: APP_GUARD, useClass: TokenGuard }] })
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
    expect(tools.map((tool) => tool.name).sort()).toEqual(['list_notes', 'publish_note']);
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
