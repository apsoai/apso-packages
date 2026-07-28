/**
 * Validation constants and groups
 *
 * Provides validation groups compatible with nestjsx/crud for seamless migration.
 */

export const CrudValidationGroups = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE'
} as const;

export type CrudValidationGroup = typeof CrudValidationGroups[keyof typeof CrudValidationGroups];

/**
 * Default validation options for different operations
 */
export const DEFAULT_VALIDATION_OPTIONS = {
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
  validationError: {
    target: false,
    value: false,
  },
  groups: {
    create: [CrudValidationGroups.CREATE],
    update: [CrudValidationGroups.UPDATE],
  },
} as const;