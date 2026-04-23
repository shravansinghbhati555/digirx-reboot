import {
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
import { THROTTLE_AUTH } from '../../common/throttler.config';
import { AuthService } from './auth.service';

const REFRESH_COOKIE = 'digirx_refresh';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @Public()
  @Throttle({ [THROTTLE_AUTH]: { limit: 10, ttl: 60_000 } })
  async login(
    @Body()
    body: {
      clinicId: string;
      email: string;
      password: string;
      branchId?: string;
    },
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.auth.login(body);
    res.cookie(
      REFRESH_COOKIE,
      `${out.refresh.sessionId}.${out.refresh.refreshToken}`,
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: (process.env.NODE_ENV ?? 'development') !== 'development',
        expires: new Date(out.refresh.expiresAt),
        path: '/auth',
      },
    );
    return {
      accessToken: out.accessToken,
      userId: out.userId,
      clinicId: out.clinicId,
      branchId: out.branchId,
    };
  }

  @Post('refresh')
  @Public()
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
      {
        httpOnly: true,
        sameSite: 'lax',
        secure: (process.env.NODE_ENV ?? 'development') !== 'development',
        expires: new Date(out.refresh.expiresAt),
        path: '/auth',
      },
    );
    return { accessToken: out.accessToken };
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
