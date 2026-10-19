import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { PortalSession } from './schemas/portal-session.schema';
import {
  PORTAL_JWT_AUDIENCE,
  PORTAL_TOKEN_SCOPE,
  portalAccessTtl,
  portalJwtSecret,
  portalRefreshDays,
  type PortalJwtClaims,
} from './portal-config';

export type IssuedPortalSession = {
  accessToken: string;
  refresh: { sessionId: string; refreshToken: string; expiresAt: Date };
};

function sha256(v: string): string {
  return crypto.createHash('sha256').update(v).digest('hex');
}

@Injectable()
export class PortalSessionService {
  constructor(
    @InjectModel(PortalSession.name)
    private readonly sessionModel: Model<PortalSession>,
    private readonly jwt: JwtService,
  ) {}

  signAccessToken(accountId: Types.ObjectId): Promise<string> {
    const claims: PortalJwtClaims = {
      sub: accountId.toHexString(),
      scope: PORTAL_TOKEN_SCOPE,
    };
    return this.jwt.signAsync(claims, {
      secret: portalJwtSecret(),
      audience: PORTAL_JWT_AUDIENCE,
      expiresIn: portalAccessTtl() as any,
    });
  }

  /** Verify a portal access token. Staff tokens fail on secret and audience. */
  verifyAccessToken(token: string): PortalJwtClaims {
    try {
      const claims = this.jwt.verify<PortalJwtClaims>(token, {
        secret: portalJwtSecret(),
        audience: PORTAL_JWT_AUDIENCE,
      });
      if (
        claims.scope !== PORTAL_TOKEN_SCOPE ||
        !Types.ObjectId.isValid(claims.sub)
      ) {
        throw new Error('bad scope');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }

  async issue(
    accountId: Types.ObjectId,
    meta: { userAgent?: string; ip?: string } = {},
  ): Promise<IssuedPortalSession> {
    const refreshToken = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + portalRefreshDays() * 24 * 60 * 60 * 1000,
    );
    const session = await this.sessionModel.create({
      accountId,
      refreshTokenHash: sha256(refreshToken),
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 300),
      ip: meta.ip,
    });
    return {
      accessToken: await this.signAccessToken(accountId),
      refresh: {
        sessionId: session._id.toHexString(),
        refreshToken,
        expiresAt,
      },
    };
  }

  /**
   * Rotate a refresh token. A token is accepted once; presenting it again
   * (a stolen copy, or a replay) fails.
   */
  async refresh(
    sessionId: string,
    refreshToken: string,
  ): Promise<IssuedPortalSession & { accountId: Types.ObjectId }> {
    if (!Types.ObjectId.isValid(sessionId))
      throw new UnauthorizedException('Invalid session');
    const newToken = crypto.randomBytes(32).toString('base64url');
    const session = await this.sessionModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(sessionId),
        refreshTokenHash: sha256(refreshToken),
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { refreshTokenHash: sha256(newToken) } },
      { returnDocument: 'after' },
    );
    if (!session) throw new UnauthorizedException('Invalid session');
    return {
      accountId: session.accountId,
      accessToken: await this.signAccessToken(session.accountId),
      refresh: {
        sessionId,
        refreshToken: newToken,
        expiresAt: session.expiresAt,
      },
    };
  }

  async revoke(sessionId: string): Promise<void> {
    if (!Types.ObjectId.isValid(sessionId)) return;
    await this.sessionModel.updateOne(
      { _id: new Types.ObjectId(sessionId), revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  async revokeAllForAccount(accountId: Types.ObjectId): Promise<void> {
    await this.sessionModel.updateMany(
      { accountId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }
}
