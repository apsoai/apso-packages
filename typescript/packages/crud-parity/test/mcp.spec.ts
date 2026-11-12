/**
 * An MCP client lists rows through @apso/mcp against a PostgREST-only @Crud
 * controller on Postgres: filtered by a column, filtered by an embed, and
 * told when a default page is partial (apsoai/cli#226).
 *
 * @apso/mcp is added to this repo by its own PR. Until both are on the same
 * branch this file skips.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AddressInfo } from 'net';
import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Crud, CrudAuth } from '@apso/crud';
import { ApPostService } from '../src/app-apso';
import { POST_CRUD_QUERY, SCOPED_AUTH } from '../src/crud-config';
import { createSeededDataSource } from '../src/datasource';
import { ALL_ENTITIES, Post } from '../src/entities';

jest.setTimeout(180000);

const hasMcp = fs.existsSync(path.join(__dirname, '../../mcp/src/index.ts'));
const QUERY = { ...POST_CRUD_QUERY, limit: 5, exclude: ['body'] };

(hasMcp ? describe : describe.skip)('MCP list tool over a PostgREST-only controller', () => {
  let app: INestApplication;
  let ds: DataSource;
  let client: any;

  beforeAll(async () => {
    // Required lazily so the file loads when the package is not there yet.
    const { McpTool, mountMcp } = require('@apso/mcp');
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
    const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

    @Crud({ model: { type: Post }, query: QUERY, dialects: ['postgrest'] })
    @Controller('posts')
    class PostController {
      constructor(public service: ApPostService) {}
    }
    @Crud({ model: { type: Post }, query: QUERY, dialects: ['postgrest'] })
    @CrudAuth(SCOPED_AUTH)
    @Controller('my-posts')
    class ScopedPostController {
      constructor(public service: ApPostService) {}
    }
    // What a generated controller does: mark the list route as a tool.
    for (const [controller, name] of [[PostController, 'list_posts'], [ScopedPostController, 'list_my_posts']] as const) {
      const proto = (controller as any).prototype;
      McpTool({ name })(proto, 'getManyBase', Object.getOwnPropertyDescriptor(proto, 'getManyBase'));
    }

    ds = await createSeededDataSource('mcp');
    @Module({
      imports: [
        TypeOrmModule.forRootAsync({ useFactory: () => ({}) as any, dataSourceFactory: async () => ds }),
        TypeOrmModule.forFeature(ALL_ENTITIES),
      ],
      controllers: [PostController, ScopedPostController],
      providers: [ApPostService],
    })
    class McpModule {}
    const mod = await Test.createTestingModule({ imports: [McpModule] }).compile();
    app = mod.createNestApplication();
    mountMcp(app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('parity').build()));
    await app.listen(0, '127.0.0.1');
    const url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/mcp`);
    client = new Client({ name: 'test', version: '1' });
    await client.connect(new StreamableHTTPClientTransport(url));
  });

  afterAll(async () => {
    for (const c of [() => client?.close(), () => app?.close(), () => ds?.destroy()]) {
      try {
        await c();
      } catch {
        // shared-pglite teardown noise
      }
    }
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    // eslint-disable-next-line no-console
    console.log(`MCP ${name} ${JSON.stringify(args)}\n -> ${result.content.map((c: any) => c.text).join('\n -> ')}`);
    return result;
  };
  const rows = (result: any) => JSON.parse(result.content[0].text);

  it('the tool schema is the PostgREST parameters, with one argument per readable column', async () => {
    const tool = (await client.listTools()).tools.find((t: any) => t.name === 'list_posts');
    // eslint-disable-next-line no-console
    console.log('MCP TOOL\n' + JSON.stringify(tool, null, 1));
    expect(Object.keys(tool.inputSchema.properties)).toEqual([
      'select', 'order', 'limit', 'offset', 'or', 'and',
      'id', 'title', 'views', 'published', 'createdAt', 'score', 'authorId',
      'embedded',
    ]);
    expect(tool.inputSchema.required).toEqual([]);
    expect(tool.description).toContain('Example: ?select=id,title,author(*)');
  });

  it('lists rows filtered by a column', async () => {
    const result = await call('list_posts', { views: 'gte.100', published: 'is.true', select: 'id,views', order: 'views.desc' });
    expect(result.isError).toBeFalsy();
    expect(rows(result)).toEqual([{ id: 3, views: 999 }, { id: 2, views: 250 }, { id: 1, views: 100 }]);
    expect(result.content).toHaveLength(1);
  });

  it('lists rows filtered by an embed', async () => {
    const result = await call('list_posts', {
      select: 'id,comments!inner(id,likes)',
      embedded: { 'comments.likes': 'gt.5' },
      order: 'id.asc',
    });
    expect(result.isError).toBeFalsy();
    expect(rows(result).map((r: any) => r.id)).toEqual([1, 2, 3, 5]);
    expect(rows(result)[0].comments).toEqual([{ id: 2, likes: 12 }]);
  });

  it('or groups and paging arguments work', async () => {
    const result = await call('list_posts', { or: '(views.eq.100,views.eq.999)', limit: 1, offset: 1, order: 'id.asc', select: 'id' });
    expect(rows(result)).toEqual([{ id: 3 }]);
  });

  it('a default page that is not everything says so', async () => {
    const result = await call('list_posts', { select: 'id', order: 'id.asc' });
    expect(rows(result).map((r: any) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.content[1].text).toBe('Partial result: rows 0-4 of 6. Send limit and offset for the rest.');
  });

  it('a mistake comes back as the 400 message', async () => {
    const result = await call('list_posts', { select: 'id,views::text' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Casts (column::type) are not supported');
  });

  it('the tool sees only the rows the route scope allows', async () => {
    const result = await call('list_my_posts', { select: 'id,authorId', authorId: 'in.(1,2,3)', order: 'id.asc' });
    expect(rows(result)).toEqual([{ id: 1, authorId: 1 }, { id: 4, authorId: 1 }]);
    expect(result.content).toHaveLength(1);
  });
});
