import { SetMetadata } from '@nestjs/common';

/**
 * Marks a patient-portal handler or controller.
 *
 * Portal routes authenticate with their own token (separate secret and
 * audience), so the staff JWT guard skips them instead of rejecting the
 * portal token. Staff routes never carry this marker, so their behaviour is
 * unchanged. Use through `@PortalRoute()` / `@PortalPublicRoute()` in the
 * patient-portal module, which add the portal's own guards.
 */
export const IS_PORTAL_ROUTE_KEY = 'is_portal_route';

export const PortalRouteMarker = () => SetMetadata(IS_PORTAL_ROUTE_KEY, true);
