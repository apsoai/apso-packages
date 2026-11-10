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
import { McpTool, mountMcp, toolsFromDocument } from './index';

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
    return { id, title: dto.title, user: req.user };
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
    app = await NestFactory.create(AppModule, { logger: false });
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('notes').build());
    mountMcp(app, document);
    await app.listen(0);
    url = new URL(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/mcp`);
  });
  afterAll(() => app.close());

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
    expect(JSON.parse(ok.content[0].text)).toEqual({ id: '7', title: 'Hello', user: 'ada' });
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
