/**
 * nestjsx/crud drop-in surface tests: the exact idioms platform/server's
 * autogen controllers use must work against @apso/crud.
 */
import 'reflect-metadata';
import { Crud } from './crud.decorator';
import {
  Override,
  ParsedRequest,
  CrudController,
  CrudRequest,
  CreateManyDto,
} from './nestjsx-compat';
import { PARSED_CRUD_REQUEST_KEY } from '@apso/crud-core';

class TestEntity {
  id!: number;
  name!: string;
}

const makeService = () => ({
  getMany: jest.fn().mockResolvedValue([{ id: 1 }]),
  getOne: jest.fn().mockResolvedValue({ id: 1 }),
  createOne: jest.fn(),
  createMany: jest.fn(),
  updateOne: jest.fn(),
  replaceOne: jest.fn(),
  deleteOne: jest.fn(),
  recoverOne: jest.fn(),
});

const fakeReq = (parsed: any = { marker: true }) => ({
  [PARSED_CRUD_REQUEST_KEY]: parsed,
});

describe('nestjsx-compatible @Crud surface', () => {
  it('injects *Base handlers onto a plain CrudController class', async () => {
    @Crud({ model: { type: TestEntity } })
    class PlainController implements CrudController<TestEntity> {
      constructor(public service: any) {}
    }

    const proto = PlainController.prototype as any;
    for (const name of [
      'getManyBase', 'getOneBase', 'createOneBase', 'createManyBase',
      'updateOneBase', 'replaceOneBase', 'deleteOneBase',
    ]) {
      expect(typeof proto[name]).toBe('function');
    }

    const service = makeService();
    const controller = new PlainController(service) as PlainController & CrudController<TestEntity>;
    // *Base handlers receive an ALREADY-parsed request (the @ParsedRequest
    // param decorator resolves it at Nest runtime; a direct call passes the
    // argument through) and delegate straight to the service — no extraction.
    const parsed = { search: {}, paramsFilter: [] };
    await controller.getManyBase!(parsed as any);
    expect(service.getMany).toHaveBeenCalledWith(parsed);

    const dto = { name: 'x' };
    await controller.createOneBase!(parsed as any, dto);
    expect(service.createOne).toHaveBeenCalledWith(parsed, dto);
  });

  it('routes through an @Override method instead of injecting', async () => {
    const service = makeService();

    @Crud({ model: { type: TestEntity } })
    class OverridingController implements CrudController<TestEntity> {
      constructor(public service: any) {}

      @Override()
      async getMany(@ParsedRequest() req: CrudRequest) {
        // custom behavior wrapping the service call, nestjsx-style
        const result = await this.service.getMany(req);
        return { wrapped: result };
      }
    }

    const proto = OverridingController.prototype as any;
    // The *Base delegator is ALWAYS provided (autogen overrides call
    // this.base.getManyBase(req)), even when an override exists.
    expect(typeof proto.getManyBase).toBe('function');

    const controller = new OverridingController(service);
    // Direct call: @ParsedRequest is a NestJS param decorator, so it is a
    // no-op outside Nest's pipeline — the argument passes through unchanged,
    // exactly like nestjsx. (At runtime Nest supplies the parsed request.)
    const parsed = { search: { id: { $eq: 1 } } } as any;
    const out = await controller.getMany(parsed);
    expect(service.getMany).toHaveBeenCalledWith(parsed);
    expect(out).toEqual({ wrapped: [{ id: 1 }] });

    // The injected delegator forwards an already-parsed request to service.
    await proto.getManyBase.call(controller, parsed);
    expect(service.getMany).toHaveBeenCalledWith(parsed);
  });

  it('supports the CreateManyDto bulk shape', () => {
    const dto: CreateManyDto<TestEntity> = { bulk: [{ id: 1, name: 'a' }] };
    expect(dto.bulk).toHaveLength(1);
  });
});
