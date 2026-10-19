import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PortalPublicRoute } from '../portal.decorators';
import { RequestOtpDto, VerifyOtpDto } from '../dto/portal.dto';
import { PortalOtpService } from '../../patient-identities/portal-otp.service';
import { PortalSessionService } from '../../patient-identities/portal-session.service';
import { PatientIdentitiesService } from '../../patient-identities/patient-identities.service';
import { normalizePortalPhone } from '../../patient-identities/identity.utils';
import {
  defaultDialCode,
  PORTAL_REFRESH_COOKIE,
  PORTAL_REFRESH_COOKIE_PATH,
} from '../../patient-identities/portal-config';
import { toPatientView } from '../views/portal.mappers';

function cookieOptions(expiresAt: Date) {
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? ('strict' as const) : ('lax' as const),
    secure: isProd,
    expires: expiresAt,
    // Scoped to the portal's auth routes: never sent to staff routes, and a
    // different name from the staff `digirx_refresh` cookie.
    path: PORTAL_REFRESH_COOKIE_PATH,
  };
}

function readCookie(req: Request): { sessionId: string; token: string } | null {
  const raw = req.cookies?.[PORTAL_REFRESH_COOKIE] as string | undefined;
  if (!raw) return null;
  const [sessionId, token] = raw.split('.', 2);
  return sessionId && token ? { sessionId, token } : null;
}

/** OTP login for patients. Separate realm from staff `/auth/*`. */
@Controller('portal/auth')
@PortalPublicRoute()
export class PortalAuthController {
  constructor(
    private readonly otp: PortalOtpService,
    private readonly sessions: PortalSessionService,
    private readonly identities: PatientIdentitiesService,
  ) {}

  @Post('request-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async requestOtp(@Body() body: RequestOtpDto, @Req() req: Request) {
    const dialCode = defaultDialCode();
    const phone = normalizePortalPhone(body.phone, dialCode);
    if (!phone) throw new UnauthorizedException('Enter a valid mobile number');
    const { ttlSeconds } = await this.otp.request({
      phone,
      dialCode,
      ip: req.ip,
    });
    return { ok: true, ttlSeconds };
  }

  @Post('verify-otp')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyOtp(
    @Body() body: VerifyOtpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const dialCode = defaultDialCode();
    const phone = normalizePortalPhone(body.phone, dialCode);
    if (!phone)
      throw new UnauthorizedException('That code is incorrect or has expired');
    await this.otp.verify(phone, body.code);

    const account = await this.identities.findOrCreateLoginAccount(
      phone,
      dialCode,
    );
    if (account.status !== 'ACTIVE')
      throw new UnauthorizedException('This account is disabled');
    await this.identities.markLogin(account);
    // New clinic records registered since the last visit get linked now.
    await this.identities.syncLinks(account);
    const links = await this.identities.activeLinks(account._id);

    const session = await this.sessions.issue(account._id, {
      userAgent: req.header('user-agent') ?? undefined,
      ip: req.ip,
    });
    res.cookie(
      PORTAL_REFRESH_COOKIE,
      `${session.refresh.sessionId}.${session.refresh.refreshToken}`,
      cookieOptions(session.refresh.expiresAt),
    );
    return {
      accessToken: session.accessToken,
      patient: toPatientView(account, {
        dobLocked: links.length > 0 && !!account.dob,
      }),
    };
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookie = readCookie(req);
    if (!cookie) throw new UnauthorizedException('Sign in to continue');
    const out = await this.sessions.refresh(cookie.sessionId, cookie.token);
    // A disabled account cannot refresh its way back in.
    await this.identities.getActiveAccount(out.accountId);
    res.cookie(
      PORTAL_REFRESH_COOKIE,
      `${out.refresh.sessionId}.${out.refresh.refreshToken}`,
      cookieOptions(out.refresh.expiresAt),
    );
    return { accessToken: out.accessToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookie = readCookie(req);
    if (cookie) await this.sessions.revoke(cookie.sessionId);
    res.clearCookie(PORTAL_REFRESH_COOKIE, {
      path: PORTAL_REFRESH_COOKIE_PATH,
    });
    return { ok: true };
  }
}
