import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { INestApplication } from '@nestjs/common';
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
}

export interface McpOptions {
  /** Server name reported to clients. */
  name?: string;
  version?: string;
  /** Where the MCP endpoint is served. Default: /mcp */
  path?: string;
}

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
      for (const parameter of [...((item as any).parameters ?? []), ...(operation.parameters ?? [])]) {
        if (parameter.in !== 'path' && parameter.in !== 'query') continue;
        properties[parameter.name] = {
          ...inline(document, parameter.schema ?? {}),
          ...(parameter.description ? { description: parameter.description } : {}),
        };
        if (parameter.in === 'query') query.push(parameter.name);
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
        description: options.description ?? operation.summary ?? operation.description ?? route,
        inputSchema: { type: 'object', properties, required },
        annotations: {
          readOnlyHint: method === 'get',
          destructiveHint: options.destructive ?? method === 'delete',
        },
        method: method.toUpperCase(),
        path,
        query,
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
  body?: unknown,
): Promise<{ statusCode: number; payload: string }> {
  return new Promise((resolve) => {
    const req = new IncomingMessage(new Socket());
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
      resolve({ statusCode: res.statusCode, payload: Buffer.concat(chunks).toString('utf8') });
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
  const qs = search.toString();

  const headers: Record<string, string> = { accept: 'application/json' };
  for (const [key, value] of Object.entries(callerHeaders)) {
    if (value !== undefined && !NOT_FORWARDED.has(key)) headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const response = await dispatchInMemory(dispatch, tool.method, qs ? `${path}?${qs}` : path, headers, args.body);
  return {
    content: [{ type: 'text' as const, text: response.payload || `HTTP ${response.statusCode}` }],
    isError: response.statusCode >= 400,
  };
}

/**
 * Serve the routes marked with @McpTool as an MCP server (Streamable HTTP,
 * stateless). Call it before the app starts, with the app's OpenAPI document.
 * Nothing is mounted when no route is marked.
 *
 * Listing tools is open, like the OpenAPI document it is built from. Calling
 * one is checked by the route's own guards.
 */
export function mountMcp(app: INestApplication, document: OpenAPIObject, options: McpOptions = {}): McpRouteTool[] {
  const tools = toolsFromDocument(document);
  if (tools.length === 0) return tools;
  const dispatch = app.getHttpAdapter().getInstance();
  const listed = tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));

  app.use(options.path ?? '/mcp', async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return;
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
      return callTool(dispatch, tool, params.arguments ?? {}, req.headers);
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
