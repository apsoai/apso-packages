/**
 * Validation Constants Tests
 */

import { CrudValidationGroups, DEFAULT_VALIDATION_OPTIONS } from './validation.constants';

describe('Validation Constants', () => {
  describe('CrudValidationGroups', () => {
    it('should have CREATE and UPDATE groups', () => {
      expect(CrudValidationGroups.CREATE).toBe('CREATE');
      expect(CrudValidationGroups.UPDATE).toBe('UPDATE');
    });

    it('should be compatible with nestjsx/crud validation groups', () => {
      // Ensure compatibility with existing usage
      const groups = [CrudValidationGroups.CREATE];
      expect(groups).toContain('CREATE');

      const updateGroups = [CrudValidationGroups.UPDATE];
      expect(updateGroups).toContain('UPDATE');
    });
  });

  describe('DEFAULT_VALIDATION_OPTIONS', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_VALIDATION_OPTIONS.transform).toBe(true);
      expect(DEFAULT_VALIDATION_OPTIONS.whitelist).toBe(true);
      expect(DEFAULT_VALIDATION_OPTIONS.forbidNonWhitelisted).toBe(true);
    });

    it('should have validation error configuration', () => {
      expect(DEFAULT_VALIDATION_OPTIONS.validationError.target).toBe(false);
      expect(DEFAULT_VALIDATION_OPTIONS.validationError.value).toBe(false);
    });

    it('should have groups configuration', () => {
      expect(DEFAULT_VALIDATION_OPTIONS.groups.create).toEqual(['CREATE']);
      expect(DEFAULT_VALIDATION_OPTIONS.groups.update).toEqual(['UPDATE']);
    });
  });
});