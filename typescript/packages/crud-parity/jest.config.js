/**
 * Differential parity suite. --runInBand: two Nest apps + two pglite
 * instances per spec file.
 *
 * @apso/crud* resolve to the loose local packages' SOURCE (they are not yet
 * reconciled into this repo — apsoai/apso-packages#14 step 1). Every shared
 * runtime dep (typeorm, @nestjs/*, rxjs, ...) is force-mapped to THIS
 * workspace's node_modules so the loose packages' own nested node_modules
 * cannot create duplicate library instances (dual-typeorm breaks decorators
 * and DataSource identity).
 */
const path = require('path');
const fs = require('fs');

// packages/crud-parity -> ../../../../ = the loose apso/packages dir
const LOOSE = path.resolve(__dirname, '../../../..');

// Nest 9 (matching platform/server) conflicts with the workspace's Nest 10
// (domain-events), so npm nests this package's copies locally. Resolve each
// mapped module from the package-local node_modules first, then the
// workspace root.
const LOCAL_NM = path.resolve(__dirname, 'node_modules');
const ROOT_NM = path.resolve(__dirname, '../../node_modules');
const nm = (mod) => (fs.existsSync(path.join(LOCAL_NM, mod)) ? path.join(LOCAL_NM, mod) : path.join(ROOT_NM, mod));
const WS_NM = ROOT_NM;

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testTimeout: 180000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    '^@apso/crud$': `${LOOSE}/apso-crud/src/index.ts`,
    '^@apso/crud-core$': `${LOOSE}/apso-crud-core/src/index.ts`,
    '^@apso/crud-request$': `${LOOSE}/apso-crud-request/src/index.ts`,
    '^@apso/crud-typeorm$': `${LOOSE}/apso-crud-typeorm/src/index.ts`,
    '^typeorm$': nm('typeorm'),
    '^@nestjsx/crud$': nm('@nestjsx/crud'),
    '^@nestjsx/crud-request$': nm('@nestjsx/crud-request'),
    '^@nestjsx/crud-typeorm$': nm('@nestjsx/crud-typeorm'),
    '^@nestjsx/util$': nm('@nestjsx/util'),
    '^@nestjs/platform-express$': nm('@nestjs/platform-express'),
    '^@nestjs/common$': nm('@nestjs/common'),
    '^@nestjs/core$': nm('@nestjs/core'),
    '^@nestjs/typeorm$': nm('@nestjs/typeorm'),
    '^@nestjs/swagger$': nm('@nestjs/swagger'),
    '^@nestjs/testing$': nm('@nestjs/testing'),
    '^rxjs$': nm('rxjs'),
    '^rxjs/(.*)$': `${nm('rxjs')}/$1`,
    '^class-transformer$': nm('class-transformer'),
    '^class-validator$': nm('class-validator'),
    '^reflect-metadata$': nm('reflect-metadata'),
  },
};
