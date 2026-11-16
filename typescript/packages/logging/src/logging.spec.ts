import 'reflect-metadata';
import { IncomingMessage, ServerResponse } from 'http';
import { AddressInfo, Socket } from 'net';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  INestApplication,
  Logger,
  Module,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ApsoCaller, useApsoLogging } from './index';

const USER_TOKEN = 'user-token-secret';
const API_KEY = 'sk_live_secret';

@Controller('notes')
class NotesController {
  private readonly logger = new Logger('Notes');

  @Get('public')
  open() {
    return { ok: true };
  }

  @Get('admin')
  admin() {
    return { ok: true };
  }

  @Get('broken')
  broken() {
    throw new Error('database is down');
  }

  @Get(':id')
  one(@Param('id') id: string) {
    this.logger.log(`loading note ${id}`);
    return { id };
  }

  @Post()
  async create(@Body() body: { title: string }) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.logger.warn('creating note');
    return { title: body.title };
  }
}

// Stands in for the generated auth guard: it tells the logger who called
// through req.apso and nothing else.
class Guard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    if (req.path === '/notes/public') return true;
    let caller: ApsoCaller | undefined;
    if (req.headers.authorization === `Bearer ${USER_TOKEN}`) {
      caller = { type: 'user', userId: 'user_1', tenantId: 'tenant_1', clientId: 'web-app' };
    } else if (req.headers['x-api-key'] === API_KEY) {
      caller = { type: 'service', keyId: 'key_1' };
    }
    if (!caller) {
      req.apso = { ...req.apso, denied: 'no valid credentials' };
      throw new UnauthorizedException();
    }
    req.apso = { ...req.apso, caller };
    if (req.path === '/notes/admin' && caller.type === 'user') {
      req.apso.denied = 'role admin required';
      throw new ForbiddenException();
    }
    return true;
  }
}

@Module({ controllers: [NotesController], providers: [{ provide: APP_GUARD, useClass: Guard }] })
class AppModule {}

describe('@apso/logging', () => {
  let app: INestApplication;
  let base: string;
  let raw: string[] = [];
  let spy: jest.SpyInstance;

  const lines = () =>
    raw
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  const requestLines = () => lines().filter((line) => line.type === 'request');
  // The request line is written when the response finishes, just after the client has it.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  const boot = async () => {
    const created = await NestFactory.create(AppModule, { bufferLogs: true });
    useApsoLogging(created); // the one line
    await created.listen(0);
    return created;
  };

  beforeAll(async () => {
    spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      raw.push(String(chunk));
      return true;
    });
    app = await boot();
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
    spy.mockRestore();
  });

  test('start-up is one summary line, every line is JSON, no line per route', () => {
    const boot = lines(); // throws if anything Nest wrote is not JSON
    expect(boot).toHaveLength(1);
    expect(boot[0]).toMatchObject({ level: 'info', type: 'startup', message: 'started', routes: 5 });
    expect(boot[0].time).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test('LOG_LEVEL=debug brings the start-up detail back', async () => {
    raw = [];
    process.env.LOG_LEVEL = 'debug';
    const second = await boot();
    delete process.env.LOG_LEVEL;
    await second.close();
    const mapped = lines().filter((line) => line.context === 'RouterExplorer');
    expect(mapped).toHaveLength(5);
    expect(mapped[0]).toMatchObject({ level: 'debug', type: 'log' });
  });

  describe('requests', () => {
    beforeEach(() => {
      raw = [];
    });

    test('a user call: who, tenant, client app, route, status, duration', async () => {
      const res = await fetch(`${base}/notes/7?token=query-secret`, { headers: { authorization: `Bearer ${USER_TOKEN}` } });
      expect(res.status).toBe(200);
      await settle();
      const [line, ...more] = requestLines();
      expect(more).toHaveLength(0);
      expect(line).toMatchObject({
        level: 'info',
        type: 'request',
        method: 'GET',
        route: '/notes/:id',
        path: '/notes/7',
        status: 200,
        caller: { type: 'user', userId: 'user_1', tenantId: 'tenant_1' },
        clientId: 'web-app',
      });
      expect(typeof line.durationMs).toBe('number');
      expect(line.requestId).toBe(res.headers.get('x-request-id'));
    });

    test('a service call is logged as service with the key id', async () => {
      await fetch(`${base}/notes/7`, { headers: { 'x-api-key': API_KEY } });
      await settle();
      expect(requestLines()[0].caller).toEqual({ type: 'service', keyId: 'key_1' });
    });

    test('an open route is logged as anonymous', async () => {
      await fetch(`${base}/notes/public`);
      await settle();
      expect(requestLines()[0]).toMatchObject({ status: 200, caller: { type: 'anonymous' } });
    });

    test('401 and 403 produce a line with the reason', async () => {
      await fetch(`${base}/notes/7`, { headers: { authorization: 'Bearer wrong-token' } });
      await fetch(`${base}/notes/admin`, { headers: { authorization: `Bearer ${USER_TOKEN}` } });
      await settle();
      const [unauthorized, forbidden] = requestLines();
      expect(unauthorized).toMatchObject({ status: 401, caller: { type: 'anonymous' }, denied: 'no valid credentials' });
      expect(forbidden).toMatchObject({ status: 403, caller: { type: 'user', userId: 'user_1' }, denied: 'role admin required' });
    });

    test('x-request-id is kept when sent, created when not or when unusable, and echoed', async () => {
      const kept = await fetch(`${base}/notes/public`, { headers: { 'x-request-id': 'req-abc.123' } });
      expect(kept.headers.get('x-request-id')).toBe('req-abc.123');

      const created = await fetch(`${base}/notes/public`);
      expect(created.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

      const replaced = await fetch(`${base}/notes/public`, { headers: { 'x-request-id': 'has spaces "and" quotes' } });
      expect(replaced.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);

      await settle();
      expect(requestLines().map((line) => line.requestId)).toEqual([
        'req-abc.123',
        created.headers.get('x-request-id'),
        replaced.headers.get('x-request-id'),
      ]);
    });

    test('lines written by application code carry the request id, also after the body is parsed', async () => {
      await fetch(`${base}/notes/7`, { headers: { 'x-api-key': API_KEY, 'x-request-id': 'get-1' } });
      await fetch(`${base}/notes`, {
        method: 'POST',
        headers: { 'x-api-key': API_KEY, 'x-request-id': 'post-1', 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Hello', password: 'body-secret' }),
      });
      await settle();
      const logs = lines().filter((line) => line.type === 'log');
      expect(logs).toEqual([
        expect.objectContaining({ level: 'info', context: 'Notes', message: 'loading note 7', requestId: 'get-1' }),
        expect.objectContaining({ level: 'warn', context: 'Notes', message: 'creating note', requestId: 'post-1' }),
      ]);
    });

    test('an unhandled error is logged with the request id and the request line says 500', async () => {
      await fetch(`${base}/notes/broken`, { headers: { 'x-api-key': API_KEY, 'x-request-id': 'boom-1' } });
      await settle();
      const error = lines().find((line) => line.type === 'log' && line.level === 'error');
      expect(error).toMatchObject({ requestId: 'boom-1', message: 'database is down' });
      expect(error.stack).toContain('NotesController.broken');
      expect(requestLines()[0]).toMatchObject({ level: 'error', status: 500, requestId: 'boom-1' });
    });

    test('an MCP tool call shares the id of the request that dispatched it and names the tool', async () => {
      // What @apso/mcp does for a tool call: an in-memory request through the
      // app's own handler, marked on req.apso, carrying the caller's headers.
      const inMemory = (headers: Record<string, string>) =>
        new Promise<ServerResponse>((resolve) => {
          const req = new IncomingMessage(new Socket());
          req.method = 'GET';
          req.url = '/notes/7';
          req.headers = headers;
          (req as any).apso = { mcp: { tool: 'get_note', clientId: 'claude-web' } };
          req.push(null);
          const res = new ServerResponse(req);
          res.end = (() => {
            res.emit('finish');
            resolve(res);
            return res;
          }) as any;
          app.getHttpAdapter().getInstance()(req, res);
        });
      // The outer request: the id the logger put on its headers is what gets forwarded.
      const outer = await fetch(`${base}/notes/public`);
      const id = outer.headers.get('x-request-id')!;
      const res = await inMemory({ 'x-api-key': API_KEY, 'x-request-id': id });
      await settle();
      expect(res.getHeader('x-request-id')).toBe(id);
      expect(requestLines()[1].aborted).toBeUndefined();
      expect(requestLines()[1]).toMatchObject({
        requestId: id,
        route: '/notes/:id',
        mcpTool: 'get_note',
        clientId: 'claude-web',
        caller: { type: 'service', keyId: 'key_1' },
      });
    });

    test('no token, key, cookie, query string or body value reaches any line', async () => {
      await fetch(`${base}/notes?api_key=query-secret`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${USER_TOKEN}`,
          cookie: 'session=cookie-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'Hello', password: 'body-secret' }),
      });
      await fetch(`${base}/notes/7`, { headers: { 'x-api-key': API_KEY } });
      await fetch(`${base}/notes/7`, { headers: { authorization: 'Bearer wrong-token' } });
      await settle();
      const output = raw.join('');
      expect(requestLines()).toHaveLength(3);
      for (const secret of [USER_TOKEN, API_KEY, 'cookie-secret', 'query-secret', 'body-secret', 'wrong-token']) {
        expect(output).not.toContain(secret);
      }
    });
  });
});
