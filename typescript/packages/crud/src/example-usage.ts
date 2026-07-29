/**
 * Example Usage of Apso CRUD Framework
 *
 * This example shows how to replace nestjsx/crud with the new Apso CRUD system.
 * It demonstrates the exact same functionality with improved type safety and performance.
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Crud } from './crud.decorator';
import { CrudController } from './crud-controller.base';
import { TypeOrmCrudService } from '@apso/crud-typeorm';

// Example Entity (same as your existing entities)
// @Entity('test-customer')
// export class TestCustomer {
//   @PrimaryGeneratedColumn()
//   id!: number;
//
//   @Column({ type: 'text', nullable: false })
//   name: string;
//
//   @Column({ type: 'text', nullable: false })
//   status: string;
//
//   @OneToMany(() => TestFacility, (facility) => facility.customer)
//   facilities: TestFacility[];
// }

// Example DTO (same as your existing DTOs)
// export class TestCustomerCreate {
//   @IsNotEmpty({ groups: [CrudValidationGroups.CREATE] })
//   @IsOptional({ groups: [CrudValidationGroups.UPDATE] })
//   name: string;
//
//   @IsNotEmpty({ groups: [CrudValidationGroups.CREATE] })
//   @IsOptional({ groups: [CrudValidationGroups.UPDATE] })
//   status: string;
// }

/**
 * Example Service - Drop-in replacement for TypeOrmCrudService
 */
// @Injectable()
// export class TestCustomerService extends TypeOrmCrudService<TestCustomer> {
//   constructor(
//     @InjectRepository(TestCustomer)
//     private customerRepository: Repository<TestCustomer>
//   ) {
//     super(customerRepository, {
//       query: {
//         limit: 5,
//         alwaysPaginate: true,
//         maxLimit: 100
//       }
//     });
//   }
//
//   // The duplicate field selection bug is automatically fixed!
//   // No need for the workaround from issue #777
// }

/**
 * Example Controller - Drop-in replacement for nestjsx/crud controller
 */
// @Crud({
//   model: { type: TestCustomer },
//   dto: {
//     create: TestCustomerCreate,
//     update: TestCustomer,
//     replace: TestCustomer,
//   },
//   query: {
//     limit: 5,
//     alwaysPaginate: true,
//     join: {
//       customer: { eager: false },
//       'customer.facilities': { eager: false },
//     },
//   },
// })
// export class TestCustomerController extends CrudController<TestCustomer> {
//   constructor(public service: TestCustomerService) {
//     super();
//   }
//
//   // All base methods are automatically available:
//   // - getMany() - with full query support
//   // - getOne() - by ID
//   // - createOne() - with validation
//   // - createMany() - bulk creation
//   // - updateOne() - partial update
//   // - replaceOne() - full replacement
//   // - deleteOne() - deletion
//   // - recoverOne() - soft delete recovery
//
//   // You can override any method to add custom logic:
//   // @Override()
//   // @ApiOperation({ summary: 'Get customers with special processing' })
//   // async getMany(@Req() req: any): Promise<GetManyResponse<TestCustomer>> {
//   //   // Custom logic before
//   //   const result = await super.getMany(req);
//   //   // Custom logic after
//   //   return result;
//   // }
//
//   // Or use hooks for cleaner code:
//   // protected async beforeGetMany(req: ParsedRequest): Promise<void> {
//   //   // Add custom logic here
//   //   console.log('Getting many customers...', req.parsed.filter);
//   // }
//
//   // protected async afterGetMany(
//   //   req: ParsedRequest,
//   //   result: GetManyResponse<TestCustomer>
//   // ): Promise<GetManyResponse<TestCustomer>> {
//   //   console.log(`Retrieved ${result.count} customers`);
//   //   return result;
//   // }
// }

/**
 * Migration Comparison:
 *
 * BEFORE (nestjsx/crud):
 * ```typescript
 * import { Crud, CrudController, CrudRequest, ParsedRequest } from '@nestjsx/crud';
 * import { TypeOrmCrudService } from '@nestjsx/crud-typeorm';
 *
 * @Injectable()
 * export class TestCustomerService extends TypeOrmCrudService<TestCustomer> {
 *   constructor(@InjectRepository(TestCustomer) repo: Repository<TestCustomer>) {
 *     super(repo);
 *   }
 *
 *   // Workaround for issue #777
 *   getSelect(query: ParsedRequestParams, options: QueryOptions) {
 *     return [...new Set(super.getSelect(query, options))];
 *   }
 * }
 *
 * @Crud({
 *   model: { type: TestCustomer },
 *   // ... same config
 * })
 * export class TestCustomerController implements CrudController<TestCustomer> {
 *   constructor(public service: TestCustomerService) {}
 * }
 * ```
 *
 * AFTER (Apso CRUD):
 * ```typescript
 * import { Crud, CrudController } from '@apso/crud';
 * import { TypeOrmCrudService } from '@apso/crud-typeorm';
 *
 * @Injectable()
 * export class TestCustomerService extends TypeOrmCrudService<TestCustomer> {
 *   constructor(@InjectRepository(TestCustomer) repo: Repository<TestCustomer>) {
 *     super(repo);
 *   }
 *   // No workaround needed - bug is fixed!
 * }
 *
 * @Crud({
 *   model: { type: TestCustomer },
 *   // ... same config (100% compatible)
 * })
 * export class TestCustomerController extends CrudController<TestCustomer> {
 *   constructor(public service: TestCustomerService) {
 *     super();
 *   }
 * }
 * ```
 *
 * BENEFITS:
 * ✅ Zero breaking changes to your existing API
 * ✅ All query parameters work exactly the same
 * ✅ Duplicate field selection bug fixed (issue #777)
 * ✅ Better TypeScript support and type inference
 * ✅ Improved performance with optimized query building
 * ✅ Enhanced Swagger documentation generation
 * ✅ Hook system for custom logic (beforeGetMany, afterGetMany, etc.)
 * ✅ Full control over the codebase - no more dependency on abandoned projects
 * ✅ Easy to extend with new features specific to your needs
 */