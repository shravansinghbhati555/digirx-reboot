import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/public.decorator';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { AuthService } from './auth.service';
import { UserFaceService } from '../user-face/user-face.service';
import { ConfirmResetPasswordDto } from './dto/confirm-reset-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LoginByEmailDto } from './dto/login-by-email.dto';
import { SignupDto } from './dto/signup.dto';

const REFRESH_COOKIE = 'digirx_refresh';
const MAX_FACE_IMAGE_BYTES = 5 * 1024 * 1024;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly userFace: UserFaceService,
  ) {}

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
      roles: out.roles,
    };
  }

  // Single-step login. The BE resolves clinic + branch from the
  // user's record. Same throttle as the legacy /auth/login.
  @Post('login-by-email')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async loginByEmail(
    @Body() body: LoginByEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.loginByEmail(body);
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
      roles: out.roles,
    };
  }

  // Face login. The FE posts a webcam frame (multipart field `image`).
  // UserFaceService identifies the staff member (cross-clinic scan,
  // anti-spoof enforced in face-svc); on a confident match we issue the
  // same session as email login. No password involved.
  @Post('login-by-face')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: MAX_FACE_IMAGE_BYTES } }),
  )
  async loginByFace(
    @UploadedFile() file: Express.Multer.File,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('image file is required (multipart field "image")');
    }
    const match = await this.userFace.identify({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname || 'login.jpg',
    });
    if (!match) {
      throw new UnauthorizedException('Face not recognized. Use email & password instead.');
    }
    const out = await this.auth.issueSessionForUser(match.userId);
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
      roles: out.roles,
    };
  }

  // Capped at 3/min/IP — signup creates a Clinic + admin User and we
  // don't want it abused for tenant-spam. Lighter than the 10/min login
  // throttle because the cost of a successful signup is much higher.
  // Registers the clinic and parks it in the approval queue. No session is
  // issued and no refresh cookie is set: the caller cannot enter the app
  // until a platform admin approves the clinic.
  @Post('signup')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async signup(@Body() body: SignupDto) {
    return this.auth.signup(body);
  }

  // Admin-only forgot-password flow. Always returns { ok: true } — see
  // auth.service.ts for the reasoning. 5/min/IP is enough for a real user
  // and cuts off enumeration-by-rate-budget attacks.
  @Post('forgot-password')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    return await this.auth.forgotPassword(body);
  }

  // Consumes the token from /auth/forgot-password. Returns 401 on
  // invalid/expired token; same uniform error so an attacker can't
  // distinguish "wrong token" from "expired".
  @Post('reset-password')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPasswordWithToken(@Body() body: ConfirmResetPasswordDto) {
    return await this.auth.resetPasswordWithToken(body);
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
