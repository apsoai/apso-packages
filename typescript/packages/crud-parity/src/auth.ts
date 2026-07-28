/**
 * Shared header guard for access-control parity. Applied class-level on the
 * secure-posts controllers in BOTH apps; every generated CRUD route must
 * behave identically behind it (401 without the header, normal with it).
 */
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

export const AUTH_HEADER = 'x-test-auth';
export const AUTH_VALUE = 'letmein';

@Injectable()
export class HeaderGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.headers[AUTH_HEADER] === AUTH_VALUE) return true;
    throw new UnauthorizedException();
  }
}
