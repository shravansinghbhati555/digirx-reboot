import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { Model, Types } from 'mongoose';
import { User, UserStatus } from '../authz/schemas/user.schema';
import { JwtClaims } from './auth.types';
import { Session } from './schemas/session.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    private readonly jwt: JwtService,
  ) {}

  private accessToken(claims: JwtClaims) {
    const expiresIn = (process.env.JWT_ACCESS_TTL ?? '8h') as unknown as string;
    return this.jwt.signAsync(claims, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
      expiresIn: expiresIn as any,
    });
  }

  private async issueRefreshSession(input: { clinicId: Types.ObjectId; userId: Types.ObjectId }) {
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = await bcrypt.hash(raw, 10);
    const days = Number(process.env.JWT_REFRESH_DAYS ?? '30');
    const expiresAt = new Date(Date.now() + (Number.isFinite(days) ? days : 30) * 24 * 60 * 60_000);

    const session = await this.sessionModel.create({
      clinicId: input.clinicId,
      userId: input.userId,
      refreshTokenHash: hash,
      expiresAt,
    });

    return { sessionId: session._id.toHexString(), refreshToken: raw, expiresAt };
  }

  async login(input: { clinicId: string; email: string; password: string; branchId?: string }) {
    const clinicId = new Types.ObjectId(input.clinicId);
    const email = input.email.trim().toLowerCase();
    const user = await this.userModel.findOne({ clinicId, email });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.Active) throw new UnauthorizedException('User disabled');
    if (!user.passwordHash) throw new UnauthorizedException('Password not set');

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const claims: JwtClaims = {
      sub: user._id.toHexString(),
      clinicId: clinicId.toHexString(),
      branchId: input.branchId ?? user.defaultBranchId?.toHexString(),
    };

    const accessToken = await this.accessToken(claims);
    const refresh = await this.issueRefreshSession({ clinicId, userId: user._id });

    return {
      accessToken,
      refresh: { sessionId: refresh.sessionId, refreshToken: refresh.refreshToken, expiresAt: refresh.expiresAt },
      userId: claims.sub,
      clinicId: claims.clinicId,
      branchId: claims.branchId ?? null,
    };
  }

  async refresh(input: { sessionId: string; refreshToken: string }) {
    const session = await this.sessionModel.findById(input.sessionId);
    if (!session) throw new UnauthorizedException('Invalid session');
    if (session.revokedAt) throw new UnauthorizedException('Session revoked');
    if (session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException('Session expired');

    const ok = await bcrypt.compare(input.refreshToken, session.refreshTokenHash);
    if (!ok) throw new UnauthorizedException('Invalid session');

    // rotate refresh token
    const newRaw = crypto.randomBytes(32).toString('base64url');
    session.refreshTokenHash = await bcrypt.hash(newRaw, 10);
    await session.save();

    const claims: JwtClaims = {
      sub: session.userId.toHexString(),
      clinicId: session.clinicId.toHexString(),
    };
    const accessToken = await this.accessToken(claims);

    return { accessToken, refresh: { sessionId: session._id.toHexString(), refreshToken: newRaw, expiresAt: session.expiresAt } };
  }

  async logout(input: { sessionId: string }) {
    await this.sessionModel.updateOne({ _id: new Types.ObjectId(input.sessionId) }, { $set: { revokedAt: new Date() } });
    return { ok: true };
  }
}

