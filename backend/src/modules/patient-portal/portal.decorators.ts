import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Public } from '../../common/public.decorator';
import { PortalRouteMarker } from '../../common/portal-route.decorator';
import { PortalAuthGuard, PortalEnabledGuard } from './portal.guards';
import { PortalAccessLogInterceptor } from './portal-access-log.interceptor';
import type { PortalCtx, PortalRequest } from './portal.context';

/**
 * Portal controller that requires a signed-in patient.
 *
 * `Public()` only tells the staff PermissionsGuard to stand aside — the
 * portal guards that follow do the real authentication. The marker makes
 * the staff JWT guard skip the route.
 */
export const PortalRoute = () =>
  applyDecorators(
    Public(),
    PortalRouteMarker(),
    UseGuards(PortalEnabledGuard, PortalAuthGuard),
    UseInterceptors(PortalAccessLogInterceptor),
  );

/** Portal route open to signed-out callers (OTP request/verify, refresh). */
export const PortalPublicRoute = () =>
  applyDecorators(Public(), PortalRouteMarker(), UseGuards(PortalEnabledGuard));

/** The authenticated portal caller. */
export const Portal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PortalCtx => {
    const req = ctx.switchToHttp().getRequest<PortalRequest>();
    if (!req.portal) throw new UnauthorizedException('Sign in to continue');
    return req.portal;
  },
);
