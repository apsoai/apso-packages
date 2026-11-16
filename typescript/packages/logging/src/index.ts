import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { INestApplication, LoggerService } from '@nestjs/common';

/** Who made the request. An auth guard writes it to `req.apso.caller`. */
export interface ApsoCaller {
  /** `user`: an end user's token. `service`: an API key (wire contract: "service caller"). */
  type: 'user' | 'service';
  userId?: string;
  /** Tenant (workspace, organization) the user acts in. */
  tenantId?: string;
  /** Id of the API key. Never the key itself. */
  keyId?: string;
  /** Client application the token was issued to, when the token names it. */
  clientId?: string;
}

/**
 * The property Apso libraries share on the request object: `req.apso`.
 * Set fields on it, never replace it: `req.apso = { ...req.apso, caller }`.
 */
export interface ApsoRequestInfo {
  /** Set by this library. */
  requestId?: string;
  /** Set by the app's auth guard. Absent means anonymous. */
  caller?: ApsoCaller;
  /** Set by the guard that refuses a request: a short reason, with no credentials in it. */
  denied?: string;
  /** Set by `@apso/mcp` on a request dispatched for a tool call. */
  mcp?: { tool: string; clientId?: string };
}

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const store = new AsyncLocalStorage<{ requestId: string }>();

/** Id of the request being handled, for passing on to another service in `x-request-id`. */
export const currentRequestId = (): string | undefined => store.getStore()?.requestId;

const enabled = (level: Level) => {
  const threshold = LEVELS.indexOf((process.env.LOG_LEVEL ?? '').toLowerCase() as Level);
  return LEVELS.indexOf(level) >= (threshold < 0 ? 1 : threshold);
};

function write(level: Level, type: string, fields: Record<string, unknown>) {
  const requestId = currentRequestId();
  process.stdout.write(
    JSON.stringify({ time: new Date().toISOString(), level, type, ...(requestId ? { requestId } : {}), ...fields }) + '\n',
  );
}

// Nest's own start-up chatter: one line per module, controller and route.
const BOOT_CONTEXTS = new Set(['NestFactory', 'InstanceLoader', 'RoutesResolver', 'RouterExplorer', 'NestApplication']);

/** Nest logger that writes one JSON line per call, with the request id of the request being handled. */
export class ApsoLogger implements LoggerService {
  private routes = 0;

  log(message: unknown, ...rest: unknown[]) {
    this.emit('info', message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.emit('error', message, rest);
  }
  fatal(message: unknown, ...rest: unknown[]) {
    this.emit('error', message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.emit('warn', message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.emit('debug', message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.emit('debug', message, rest);
  }

  private emit(level: Level, message: unknown, rest: unknown[]) {
    // Nest passes the context as the last argument, and a stack before it on error().
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    let stack = level === 'error' && typeof rest[0] === 'string' ? (rest.shift() as string) : undefined;

    if (level === 'info' && context && BOOT_CONTEXTS.has(context)) {
      if (context === 'RouterExplorer') this.routes += 1;
      if (message === 'Nest application successfully started') {
        write('info', 'startup', { message: 'started', routes: this.routes, uptimeMs: Math.round(process.uptime() * 1000) });
        return;
      }
      level = 'debug';
    }
    if (!enabled(level)) return;

    if (message instanceof Error) {
      stack = stack ?? message.stack;
      message = message.message;
    }
    write(level, 'log', {
      ...(context ? { context } : {}),
      message,
      ...(stack ? { stack } : {}),
      ...(rest.length > 0 ? { extra: rest } : {}),
    });
  }
}

/**
 * Express middleware: gives every request an id, echoes it on the response,
 * and writes one line when the response is done. Headers, query strings and
 * bodies are never read into the line.
 */
export function requestLogging() {
  return (req: IncomingMessage & { apso?: ApsoRequestInfo }, res: ServerResponse, next: () => void) => {
    const sent = req.headers['x-request-id'];
    const requestId = typeof sent === 'string' && /^[\w.:-]{1,128}$/.test(sent) ? sent : randomUUID();
    // On the headers too, so a request dispatched from this one (an MCP tool
    // call, a call to another service) carries the same id.
    req.headers['x-request-id'] = requestId;
    req.apso = { ...req.apso, requestId };
    res.setHeader('x-request-id', requestId);

    const started = process.hrtime.bigint();
    let written = false;
    const line = (aborted: boolean) => {
      if (written) return;
      written = true;
      const express = req as any;
      const { caller, denied, mcp } = (req.apso ?? {}) as ApsoRequestInfo;
      const clientId = caller?.clientId ?? mcp?.clientId;
      // Request lines are the audit trail: written whatever LOG_LEVEL says.
      write(res.statusCode >= 500 ? 'error' : 'info', 'request', {
        requestId,
        method: req.method,
        ...(express.route?.path ? { route: `${express.baseUrl ?? ''}${express.route.path}` } : {}),
        path: (express.originalUrl ?? req.url ?? '').split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e6),
        // Field by field: a guard that puts more on the caller does not get it logged.
        caller: caller
          ? { type: caller.type, userId: caller.userId, tenantId: caller.tenantId, keyId: caller.keyId }
          : { type: 'anonymous' },
        ...(clientId ? { clientId } : {}),
        ...(mcp?.tool ? { mcpTool: mcp.tool } : {}),
        ...(denied ? { denied } : {}),
        ...(aborted ? { aborted } : {}),
      });
    };
    res.once('finish', () => line(false));
    res.once('close', () => line(true));
    store.run({ requestId }, next);
  };
}

/**
 * The one line for a service's bootstrap, straight after NestFactory.create:
 * replaces Nest's logger and logs every request. Create the app with
 * `{ bufferLogs: true }` so the lines Nest writes before this call come out in
 * the same format.
 */
export function useApsoLogging<T extends INestApplication>(app: T): T {
  app.useLogger(new ApsoLogger());
  app.use(requestLogging());
  return app;
}
