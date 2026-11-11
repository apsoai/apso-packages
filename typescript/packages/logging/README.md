# @apso/logging

Request logging for Apso NestJS services. It replaces Nest's default logger and writes JSON lines to standard output:

- one line per request that says who called, what they called, the status and the duration
- a request id on every line written while a request is handled
- one start-up line in place of Nest's line per module and route

The only dependency is `@nestjs/common`, as a peer. The request id is carried with Node's `AsyncLocalStorage`.

## Use

```ts
import { useApsoLogging } from '@apso/logging';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
useApsoLogging(app);
```

Call it straight after `NestFactory.create`, before any other `app.use` and before `mountMcp`, so every request passes through it. `bufferLogs: true` holds the lines Nest writes while it builds the app until the logger is in place. Without it those lines come out in Nest's own format.

Application code keeps using Nest's `Logger`. Its lines come out as JSON with the request id, without passing the id around:

```ts
private readonly logger = new Logger('Invoices');
this.logger.log('approved');
// {"time":"...","level":"info","type":"log","requestId":"...","context":"Invoices","message":"approved"}
```

`currentRequestId()` returns the id of the request being handled, for sending on to another service in `x-request-id`.

`LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) filters `log` lines. Request lines are always written.

## Telling the logger who called: `req.apso`

The library does not authenticate anyone. Your auth guard already knows who the caller is and writes it to `req.apso.caller`. The request line is written when the response finishes, after the guards have run.

```ts
import { ApsoCaller } from '@apso/logging';

// in the guard, once the caller is known
req.apso = { ...req.apso, caller: { type: 'user', userId, tenantId } };

// when the guard refuses the request
req.apso = { ...req.apso, denied: 'token expired' };
throw new UnauthorizedException();
```

`req.apso` is a plain property on the request object. A guard does not have to import this package to set it.

```ts
interface ApsoRequestInfo {
  requestId?: string;      // set by @apso/logging
  caller?: ApsoCaller;     // set by the auth guard; absent means anonymous
  denied?: string;         // set by the guard that refuses the request
  mcp?: { tool: string; clientId?: string }; // set by @apso/mcp on a tool call
}

interface ApsoCaller {
  type: 'user' | 'service';
  userId?: string;
  tenantId?: string;
  keyId?: string;          // id of the API key, never the key
  clientId?: string;       // client application the token was issued to
}
```

Rules for whoever writes to it:

- Add fields with a spread, as above. Replacing the object drops the request id and the MCP mark.
- A user caller sets `type: 'user'`, `userId` and, when the service is multi-tenant, `tenantId`.
- A service caller (a valid API key, or a valid `x-apso-service-token` in platform mode) sets `type: 'service'` and `keyId`. In platform mode `keyId` is the part of the token's `sub` after `apikey:`.
- `denied` is a short reason such as `token expired` or `role admin required`. Put no credential in it.
- Only the five caller fields above are logged. Anything else a guard puts on the caller is ignored.

## Line format (all languages)

This section is the specification. The Python and Go templates emit the same lines.

Every line is one JSON object on standard output, ending in a newline, with these fields first:

| Field | Type | Notes |
|---|---|---|
| `time` | string | UTC, ISO 8601 with milliseconds, for example `2026-11-11T18:25:46.634Z` |
| `level` | string | `debug`, `info`, `warn` or `error` |
| `type` | string | `request`, `log` or `startup` |
| `requestId` | string | on every `request` line and on every `log` line written while a request is handled |

### `request`: one per request, written when the response is done

| Field | Type | Notes |
|---|---|---|
| `method` | string | HTTP method |
| `route` | string | the matched route template, for example `/invoices/:id/approve`. Absent when no route matched |
| `path` | string | the request path without the query string |
| `status` | number | HTTP status |
| `durationMs` | number | whole milliseconds from the first middleware to the end of the response |
| `caller` | object | `{"type":"user","userId","tenantId"}`, `{"type":"service","keyId"}` or `{"type":"anonymous"}`. A user caller that used an API key as well may carry `keyId` |
| `clientId` | string | the client application, when the token names it |
| `mcpTool` | string | the tool name, when the request is an MCP tool call |
| `denied` | string | the reason, on a refused request |
| `aborted` | `true` | present when the connection closed before the response was complete |

`level` is `error` when `status` is 500 or above, otherwise `info`. Absent values are left out, not written as `null`.

```json
{"time":"2026-11-11T18:25:46.634Z","level":"info","type":"request","requestId":"cf040c60-186b-4337-983f-2cac961d01e6","method":"POST","route":"/invoices/:id/approve","path":"/invoices/7/approve","status":201,"durationMs":12,"caller":{"type":"user","userId":"user_1","tenantId":"tenant_1"},"clientId":"claude-web","mcpTool":"approve_invoice"}
{"time":"2026-11-11T18:25:47.101Z","level":"info","type":"request","requestId":"6f8b292f-2db1-468a-b956-4af5925ddc7d","method":"GET","route":"/invoices/:id","path":"/invoices/7","status":401,"durationMs":1,"caller":{"type":"anonymous"},"denied":"token expired"}
{"time":"2026-11-11T18:25:47.300Z","level":"info","type":"request","requestId":"b1c9d7de-3a51-4b0e-9a55-0d7e1f6c2a10","method":"GET","route":"/invoices","path":"/invoices","status":200,"durationMs":4,"caller":{"type":"service","keyId":"key_1"}}
```

### `log`: a line written by application or framework code

| Field | Type | Notes |
|---|---|---|
| `message` | string | |
| `context` | string | the logger's name, when it has one |
| `stack` | string | on errors, when there is one |
| `extra` | array | further arguments passed to the logger, when there are any |

### `startup`: one line when the service is ready

| Field | Type | Notes |
|---|---|---|
| `message` | string | `started` |
| `routes` | number | number of routes registered |
| `uptimeMs` | number | milliseconds since the process started |

The framework's own start-up lines (one per module and route) are `log` lines at `debug` level.

### Request id

- Read `x-request-id` from the request. Keep it when it is 1 to 128 characters of letters, digits, `_`, `.`, `:` or `-`. Otherwise create a UUID.
- Return it in the `x-request-id` response header, on every response.
- Put it on every line written while the request is handled.
- Send it on when the service calls another service. An MCP tool call and the API request it dispatches share one id: the logger writes the id onto the incoming request's headers, and `@apso/mcp` forwards the caller's headers to the route.

### Never logged

Header values (`Authorization`, `x-api-key`, `x-apso-service-token`, `Cookie`), query strings and request or response bodies. The request line is built only from the fields above. What application code passes to the logger is the application's choice.

## Limits

- Express only.
- The reason for a 401 or 403 is logged only when the guard sets `req.apso.denied`. The library does not read exception messages.
