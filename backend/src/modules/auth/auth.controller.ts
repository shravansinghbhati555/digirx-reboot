import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/public.decorator';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

const REFRESH_COOKIE = 'digirx_refresh';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(body);
    res.cookie(
      REFRESH_COOKIE,
      `${out.refresh.sessionId}.${out.refresh.refreshToken}`,
      refreshCookieOptions(out.refresh.expiresAt),
    );
    return {
      accessToken: out.accessToken,
      userId: out.userId,
      clinicId: out.clinicId,
      branchId: out.branchId,
    };
  }

  // Capped at 3/min/IP — signup creates a Clinic + admin User and we
  // don't want it abused for tenant-spam. Lighter than the 10/min login
  // throttle because the cost of a successful signup is much higher.
  @Post('signup')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async signup(
    @Body() body: SignupDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.signup(body);
    res.cookie(
      REFRESH_COOKIE,
      `${out.refresh.sessionId}.${out.refresh.refreshToken}`,
      refreshCookieOptions(out.refresh.expiresAt),
    );
    return {
      accessToken: out.accessToken,
      userId: out.userId,
      clinicId: out.clinicId,
      branchId: out.branchId,
      clinicName: out.clinicName,
      branchName: out.branchName,
    };
  }

  @Post('refresh')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw new UnauthorizedException('Missing refresh cookie');
    const [sessionId, refreshToken] = raw.split('.', 2);
    if (!sessionId || !refreshToken)
      throw new UnauthorizedException('Invalid refresh cookie');

    const out = await this.auth.refresh({ sessionId, refreshToken });
    res.cookie(
      REFRESH_COOKIE,
      `${out.refresh.sessionId}.${out.refresh.refreshToken}`,
      refreshCookieOptions(out.refresh.expiresAt),
    );
    return { accessToken: out.accessToken };
  }

  @Post('switch-branch')
  @RequirePermissions()
  async switchBranch(
    @Req() req: AppRequest,
    @Body() body: { branchId?: string },
  ) {
    if (!body?.branchId || typeof body.branchId !== 'string') {
      throw new BadRequestException('branchId is required');
    }
    const actorUserId = req.context?.actorUserId;
    const clinicId = req.context?.clinicId;
    if (!actorUserId || !clinicId) {
      throw new UnauthorizedException('Missing auth context');
    }

    // Pull the refresh session id from the cookie so we can persist the
    // new branch on it. If the cookie is missing the switch still works
    // but the choice won't survive the next /auth/refresh rotation.
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const sessionId = raw ? raw.split('.', 2)[0] : '';

    const out = await this.auth.switchBranch({
      actorUserId,
      clinicId,
      sessionId,
      targetBranchId: body.branchId,
    });

    return out;
  }

  @Post('logout')
  @Public()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (raw) {
      const [sessionId] = raw.split('.', 2);
      if (sessionId) await this.auth.logout({ sessionId });
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return { ok: true };
  }
}

/**
 * Cookie attributes for the refresh-token cookie. Pulled into a helper so
 * `/auth/login` and `/auth/refresh` issue identical cookies — divergence
 * here was a real source of "logged in but can't refresh" bugs.
 *
 *   httpOnly: true      — never readable from JS, prevents XSS theft.
 *   secure: true (prod) — only ever transmitted over TLS.
 *   sameSite: strict (prod) — blocks cross-site CSRF that would attach
 *                              the refresh cookie to a forged request.
 *   sameSite: lax (dev) — needed for the localhost FE on a different port.
 *   path: '/auth'       — cookie is only attached to /auth/* requests.
 */
function refreshCookieOptions(expiresAt: Date | number | string) {
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? ('strict' as const) : ('lax' as const),
    secure: isProd,
    expires: expiresAt instanceof Date ? expiresAt : new Date(expiresAt),
    path: '/auth',
  };
}
