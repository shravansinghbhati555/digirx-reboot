import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isPortalEnabled } from '../patient-identities/portal-config';
import { PortalSessionService } from '../patient-identities/portal-session.service';
import { PatientIdentitiesService } from '../patient-identities/patient-identities.service';
import type { PortalRequest } from './portal.context';

/** Hides every portal route (404) unless PATIENT_PORTAL_ENABLED=true. */
@Injectable()
export class PortalEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!isPortalEnabled()) throw new NotFoundException();
    return true;
  }
}

/**
 * Authenticates a portal access token (portal secret + audience + scope)
 * and loads the account. A staff token fails here; a portal token fails
 * on every staff route.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: PortalSessionService,
    private readonly identities: PatientIdentitiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PortalRequest>();
    const auth = req.header('authorization') ?? '';
    if (!auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Sign in to continue');
    }
    const claims = this.sessions.verifyAccessToken(auth.slice(7).trim());
    const account = await this.identities.getActiveAccount(claims.sub);
    req.portal = {
      accountId: account._id,
      account,
      touched: new Set<string>(),
      ip: req.ip,
      userAgent: req.header('user-agent') ?? undefined,
    };
    return true;
  }
}
