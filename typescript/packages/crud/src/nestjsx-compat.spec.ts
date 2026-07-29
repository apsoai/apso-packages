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
    const parsed = { search: {}, paramsFilter: [] };
    await controller.getManyBase!(fakeReq(parsed) as any);
    // The injected handler unwraps the raw request into the parsed one
    expect(service.getMany).toHaveBeenCalledWith(parsed);

    const dto = { name: 'x' };
    await controller.createOneBase!(fakeReq(parsed) as any, dto);
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
    // No injected base handler when an override exists
    expect(proto.getManyBase).toBeUndefined();

    const controller = new OverridingController(service);
    const parsed = { search: { id: { $eq: 1 } } };
    const out = await controller.getMany(fakeReq(parsed) as any);
    // @ParsedRequest delivered the parsed request, not the raw req
    expect(service.getMany).toHaveBeenCalledWith(parsed);
    expect(out).toEqual({ wrapped: [{ id: 1 }] });
  });

  it('supports the CreateManyDto bulk shape', () => {
    const dto: CreateManyDto<TestEntity> = { bulk: [{ id: 1, name: 'a' }] };
    expect(dto.bulk).toHaveLength(1);
  });
});
