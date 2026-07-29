/**
 * Core CRUD constants
 */

export const CRUD_POLICY_ACTIONS = {
  READ_ALL: 'READ-ALL',
  READ_ONE: 'READ-ONE',
  CREATE_ONE: 'CREATE-ONE',
  CREATE_MANY: 'CREATE-MANY',
  UPDATE_ONE: 'UPDATE-ONE',
  REPLACE_ONE: 'REPLACE-ONE',
  DELETE_ONE: 'DELETE-ONE',
  RECOVER_ONE: 'RECOVER-ONE',
} as const;

export const PARSED_CRUD_REQUEST_KEY = 'PARSED_CRUD_REQUEST_KEY';
export const CRUD_OPTIONS_METADATA = 'CRUD_OPTIONS_METADATA';
export const CRUD_CONTROLLER_METADATA = 'CRUD_CONTROLLER_METADATA';

export const DEFAULT_PAGE_SIZE = 20;
export const DEFAULT_MAX_LIMIT = 100;
export const DEFAULT_QUERY_LIMIT = 20;

export const CRUD_ROUTES = {
  GET_MANY: 'getManyBase',
  GET_ONE: 'getOneBase',
  CREATE_ONE: 'createOneBase',
  CREATE_MANY: 'createManyBase',
  UPDATE_ONE: 'updateOneBase',
  REPLACE_ONE: 'replaceOneBase',
  DELETE_ONE: 'deleteOneBase',
  RECOVER_ONE: 'recoverOneBase',
} as const;