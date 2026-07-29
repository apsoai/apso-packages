/**
 * Framework-agnostic errors, safe to throw from the client-usable
 * request parser (no @nestjs / server dependency). The NestJS layer
 * (crud package's interceptor) maps RequestQueryException to a 400,
 * mirroring @nestjsx/crud-request's RequestQueryException.
 */

/** Thrown by the query parser on malformed/invalid query input. */
export class RequestQueryException extends Error {
  /** HTTP status a framework adapter should map this to. */
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'RequestQueryException';
    // Preserve prototype chain when compiled to ES5-ish targets.
    Object.setPrototypeOf(this, RequestQueryException.prototype);
  }
}
