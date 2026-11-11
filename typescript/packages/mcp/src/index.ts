import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { ApiExtension, OpenAPIObject } from '@nestjs/swagger';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/** OpenAPI extension key that marks an operation as an MCP tool. */
export const MCP_EXTENSION = 'x-apso-mcp';

export interface McpToolOptions {
  /** Tool name the model sees. Default: the route's OpenAPI operationId. */
  name?: string;
  /** What the tool does, written for a model. Default: the route's summary. */
  description?: string;
  /** Marks the tool as destructive. Default: true for DELETE routes. */
  destructive?: boolean;
}

/**
 * Expose a controller route as an MCP tool. The tool is the route: a call
 * runs through the app's HTTP pipeline, so guards, pipes and filters apply
 * exactly as they do for a REST caller.
 */
export const McpTool = (options: McpToolOptions = {}): MethodDecorator =>
  ApiExtension(MCP_EXTENSION, options) as MethodDecorator;

export interface McpRouteTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, any>; required: string[] };
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
  method: string;
  /** OpenAPI path template, e.g. /invoices/{id} */
  path: string;
  query: string[];
  /**
   * Query arguments that are objects sent one key per query parameter (OpenAPI
   * `style: form, explode: true`): `{ "posts.title": "eq.x" }` goes out as
   * `?posts.title=eq.x`.
   */
  spread: string[];
}

/**
 * DI token for the app's MCP sign-in settings. Provide a McpAuth under this
 * token in any module and mountMcp picks it up, so the app's bootstrap does
 * not have to change when auth is configured.
 */
export const MCP_AUTH = 'APSO_MCP_AUTH';

/**
 * Sign-in for MCP clients, when callers authenticate with OAuth access tokens
 * from an identity provider (Auth0, Clerk, ...). The server only describes
 * where to sign in (RFC 9728) and checks tokens; it never issues them.
 */
export interface McpAuth {
  /** Issuer URLs of the identity providers whose tokens the API accepts. */
  authorizationServers: string[];
  /**
   * Checks the request's credentials the same way the API does. Reject (throw)
   * when they are missing, invalid or not issued for this API. When it resolves
   * to an object with a string `clientId` (the client application the token was
   * issued to), tool calls carry it at `req.apso.mcp.clientId`.
   */
  verify: (req: IncomingMessage) => Promise<unknown>;
  /**
   * Public URL of the MCP endpoint, e.g. https://api.example.com/mcp. Clients
   * ask the identity provider for a token for this URL. Default: built from
   * the request's host, which is only right when no proxy rewrites it.
   */
  resource?: string;
  scopesSupported?: string[];
}

export interface McpOptions {
  /** Server name reported to clients. */
  name?: string;
  version?: string;
  /** Where the MCP endpoint is served. Default: /mcp */
  path?: string;
  /** OAuth sign-in for MCP clients. Default: the MCP_AUTH provider, when the app has one. */
  auth?: McpAuth;
  /**
   * Origins a browser-based MCP client may call the endpoint from. Default: the
   * app's own setting, the comma-separated ALLOWED_ORIGINS environment
   * variable. '*' allows every origin. A request whose Origin header is not
   * allowed gets 403; requests without an Origin header (every non-browser
   * client) are not affected.
   */
  allowedOrigins?: string[] | '*';
}

/**
 * How a route, guard or interceptor tells that a request is an MCP tool call:
 * `req.apso.mcp` is set on every request dispatched for a tool. It is a
 * property of the in-memory request object, so no header or body a REST
 * caller sends can set it. `@apso/logging` reads the same property.
 */
export interface McpOrigin {
  /** Name of the tool that was called. */
  tool: string;
  /** Client application the caller's token was issued to, when McpAuth.verify reports it. */
  clientId?: string;
}

// What a browser client has to send and read on the MCP endpoint (Streamable
// HTTP transport and RFC 9728 challenge). Request headers are reflected from
// the preflight when it names them; this list is the fallback.
const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID, X-Api-Key, X-Request-Id';
const CORS_EXPOSE_HEADERS = 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version, X-Request-Id';

const PRM_PATH = '/.well-known/oauth-protected-resource';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

// Headers that describe the MCP request itself, not the caller. Everything
// else (authorization, cookie, x-api-key, ...) is forwarded to the route.
const NOT_FORWARDED = new Set([
  'accept',
  'connection',
  'content-length',
  'content-type',
  'mcp-protocol-version',
  'mcp-session-id',
  'transfer-encoding',
]);

/** Replace every $ref with the schema it points to; MCP clients get one self-contained schema. */
const inline = (document: OpenAPIObject, node: any, seen: string[] = []): any => {
  if (Array.isArray(node)) return node.map((item) => inline(document, item, seen));
  if (!node || typeof node !== 'object') return node;
  if (typeof node.$ref === 'string') {
    const name = node.$ref.split('/').pop() as string;
    // ponytail: a self-referencing schema is cut to "any object" where it repeats.
    if (seen.includes(name)) return { type: 'object' };
    return inline(document, document.components?.schemas?.[name] ?? {}, [...seen, name]);
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, inline(document, value, seen)]));
};

/** Build the tool list from the routes marked with @McpTool in an OpenAPI document. */
export function toolsFromDocument(document: OpenAPIObject): McpRouteTool[] {
  const tools: McpRouteTool[] = [];
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    for (const method of METHODS) {
      const operation: any = (item as any)[method];
      const options: McpToolOptions | undefined = operation?.[MCP_EXTENSION];
      if (!options) continue;

      const route = `${method.toUpperCase()} ${path}`;
      const name = options.name ?? operation.operationId;
      if (!/^[\w-]{1,64}$/.test(name ?? '')) {
        throw new Error(`@McpTool on ${route}: name "${name}" must be 1-64 letters, digits, _ or -`);
      }
      if (tools.some((tool) => tool.name === name)) {
        throw new Error(`@McpTool on ${route}: another tool is already named "${name}"`);
      }

      const properties: Record<string, any> = {};
      const required: string[] = [];
      const query: string[] = [];
      const spread: string[] = [];
      for (const parameter of [...((item as any).parameters ?? []), ...(operation.parameters ?? [])]) {
        if (parameter.in !== 'path' && parameter.in !== 'query') continue;
        const schema = inline(document, parameter.schema ?? {});
        properties[parameter.name] = {
          ...schema,
          ...(parameter.description ? { description: parameter.description } : {}),
        };
        // An object in the query is exploded by default (style: form).
        const exploded = schema.type === 'object' && parameter.explode !== false && (parameter.style ?? 'form') === 'form';
        if (parameter.in === 'query') (exploded ? spread : query).push(parameter.name);
        if (parameter.required) required.push(parameter.name);
      }

      const body = operation.requestBody?.content?.['application/json']?.schema;
      if (body) {
        const schema = inline(document, body);
        // A body typed `any` gives the model nothing to fill in.
        if (schema.type === 'object' && !schema.properties && !schema.additionalProperties) {
          throw new Error(`@McpTool on ${route}: the body has no schema. Type it with a DTO class whose fields use @ApiProperty.`);
        }
        properties.body = schema;
        required.push('body');
      }

      tools.push({
        name,
        // The operation description is where a route explains its query syntax.
        description: options.description ?? ([operation.summary, operation.description].filter(Boolean).join('. ') || route),
        inputSchema: { type: 'object', properties, required },
        annotations: {
          readOnlyHint: method === 'get',
          destructiveHint: options.destructive ?? method === 'delete',
        },
        method: method.toUpperCase(),
        path,
        query,
        spread,
      });
    }
  }
  return tools;
}

/**
 * Hand one request to the app's HTTP handler without a network hop, the way a
 * Lambda adapter does. The whole pipeline runs: middleware, guards, pipes.
 */
function dispatchInMemory(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  method: string,
  url: string,
  headers: Record<string, string>,
  origin: McpOrigin,
  body?: unknown,
): Promise<{ statusCode: number; payload: string; contentRange?: string }> {
  return new Promise((resolve) => {
    const req = new IncomingMessage(new Socket());
    (req as any).apso = { mcp: origin };
    req.method = method;
    req.url = url;
    req.headers = { ...headers };
    if (body !== undefined) {
      const data = Buffer.from(JSON.stringify(body));
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(data.length);
      req.push(data);
    }
    req.push(null);

    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const collect = (chunk: unknown, encoding: unknown) => {
      if (chunk && typeof chunk !== 'function') {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? (encoding as BufferEncoding) : 'utf8'));
      }
    };
    res.write = ((chunk: unknown, encoding?: unknown) => {
      collect(chunk, encoding);
      return true;
    }) as any;
    res.end = ((chunk?: unknown, encoding?: unknown) => {
      collect(chunk, encoding);
      res.emit('finish');
      const contentRange = res.getHeader('content-range');
      resolve({
        statusCode: res.statusCode,
        payload: Buffer.concat(chunks).toString('utf8'),
        ...(contentRange ? { contentRange: String(contentRange) } : {}),
      });
      return res;
    }) as any;
    handler(req, res);
  });
}

/** Run one tool as an in-memory HTTP request against the app, as the MCP caller. */
async function callTool(
  dispatch: any,
  tool: McpRouteTool,
  args: Record<string, any>,
  callerHeaders: IncomingMessage['headers'],
  clientId?: string,
) {
  const missing: string[] = [];
  const path = tool.path.replace(/\{(\w+)\}/g, (_, key) => {
    if (args[key] === undefined || args[key] === null || args[key] === '') missing.push(key);
    return encodeURIComponent(String(args[key]));
  });
  if (missing.length > 0) {
    return { content: [{ type: 'text' as const, text: `Missing ${missing.join(', ')}` }], isError: true };
  }

  const search = new URLSearchParams();
  for (const key of tool.query) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  for (const key of tool.spread) {
    const value = args[key];
    if (!value || typeof value !== 'object') continue;
    for (const [name, item] of Object.entries(value)) {
      if (item !== undefined && item !== null) search.append(name, String(item));
    }
  }
  const qs = search.toString();

  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [key, value] of Object.entries(callerHeaders)) {
    if (value !== undefined && !NOT_FORWARDED.has(key)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const response = await dispatchInMemory(dispatch, tool.method, qs ? `${path}?${qs}` : path, headers, { tool: tool.name, ...(clientId ? { clientId } : {}) }, args.body);
  const content = [{ type: 'text' as const, text: response.payload || `HTTP ${response.statusCode}` }];
  // 206: the route returned part of the matching rows. The model only sees
  // the body, so say it, or a default page size reads as the whole result.
  if (response.statusCode === 206 && response.contentRange) {
    content.push({
      type: 'text' as const,
      text: `Partial result: rows ${response.contentRange.replace('/', ' of ')}. Send limit and offset for the rest.`,
    });
  }
  return { content, isError: response.statusCode >= 400 };
}

/** The MCP endpoint's public URL: the configured one, else what the request used. */
function resourceUrl(req: IncomingMessage, auth: McpAuth, mcpPath: string): URL {
  if (auth.resource) return new URL(auth.resource);
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(',')[0].trim();
  const proto = first(req.headers['x-forwarded-proto']) ?? ((req.socket as any)?.encrypted ? 'https' : 'http');
  const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
  return new URL(`${proto}://${host}${mcpPath}`);
}

/** Where a client finds the sign-in metadata for this endpoint (RFC 9728 path form). */
function metadataUrl(resource: URL): string {
  return `${resource.origin}${PRM_PATH}${resource.pathname === '/' ? '' : resource.pathname}`;
}

/**
 * Serve the routes marked with @McpTool as an MCP server (Streamable HTTP,
 * stateless). Call it before the app starts, with the app's OpenAPI document.
 * Nothing is mounted when no route is marked.
 *
 * Calling a tool is always checked by the route's own guards. With OAuth
 * sign-in configured (McpAuth), every request to the endpoint needs a valid
 * token and an unauthenticated one gets the 401 that starts sign-in.
 * Without it, listing tools is open, like the OpenAPI document.
 */
export function mountMcp(app: INestApplication, document: OpenAPIObject, options: McpOptions = {}): McpRouteTool[] {
  const tools = toolsFromDocument(document);
  if (tools.length === 0) return tools;
  const dispatch = app.getHttpAdapter().getInstance();
  const mcpPath = options.path ?? '/mcp';
  // Look the provider up by scanning modules: app.get() on a missing token
  // ends the process under Nest's default abortOnError. No provider means
  // callers authenticate some other way (API key, session).
  let auth = options.auth;
  for (const module of auth ? [] : app.get(ModulesContainer).values()) {
    auth = auth ?? (module.providers.get(MCP_AUTH)?.instance as McpAuth | undefined);
  }

  if (auth) {
    const settings = auth;
    // Tells an MCP client where to sign in. Public by design, and readable
    // from a browser-based client on another origin.
    app.use(PRM_PATH, (req: IncomingMessage, res: ServerResponse) => {
      const resource = resourceUrl(req, settings, mcpPath);
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'max-age=300' });
      res.end(
        JSON.stringify({
          resource: resource.href.replace(/\/$/, ''),
          authorization_servers: settings.authorizationServers,
          bearer_methods_supported: ['header'],
          ...(settings.scopesSupported ? { scopes_supported: settings.scopesSupported } : {}),
        }),
      );
    });
  }

  const listed = tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));

  const allowedOrigins =
    options.allowedOrigins ??
    (process.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

  app.use(mcpPath, async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin) {
      // The MCP transport requires 403 for an Origin that is not allowed.
      if (allowedOrigins !== '*' && !allowedOrigins.includes(origin)) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' }, id: null }));
        return;
      }
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-expose-headers', CORS_EXPOSE_HEADERS);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-methods': 'POST',
          'access-control-allow-headers': req.headers['access-control-request-headers'] ?? CORS_ALLOW_HEADERS,
          'access-control-max-age': '86400',
        });
        res.end();
        return;
      }
    }
    let clientId: string | undefined;
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
    }
    if (auth) {
      try {
        const verified: any = await auth.verify(req);
        if (typeof verified?.clientId === 'string') clientId = verified.clientId;
      } catch {
        // The 401 is what starts sign-in: it points the client at the metadata.
        const challenge = `Bearer resource_metadata="${metadataUrl(resourceUrl(req, auth, mcpPath))}"`;
        res.writeHead(401, {
          'www-authenticate': req.headers.authorization ? `${challenge}, error="invalid_token"` : challenge,
          'content-type': 'application/json',
        });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
    }
    const server = new Server(
      { name: options.name ?? document.info?.title ?? 'api', version: options.version ?? document.info?.version ?? '1.0' },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      const tool = tools.find((candidate) => candidate.name === params.name);
      if (!tool) {
        return { content: [{ type: 'text' as const, text: `Unknown tool ${params.name}` }], isError: true };
      }
      return callTool(dispatch, tool, params.arguments ?? {}, req.headers, clientId);
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  });
  return tools;
}
