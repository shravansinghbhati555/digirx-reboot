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
  ) { }

  private accessToken(claims: JwtClaims) {
    const expiresIn = (process.env.JWT_ACCESS_TTL ?? '8h') as unknown as string;
    return this.jwt.signAsync(claims, {
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me',
      expiresIn: expiresIn as any,
    });
  }

  private async issueRefreshSession(input: {
    clinicId: Types.ObjectId;
    userId: Types.ObjectId;
    branchId?: Types.ObjectId;
  }) {
    const raw = crypto.randomBytes(32).toString('base64url');
    const hash = await bcrypt.hash(raw, 10);
    const days = Number(process.env.JWT_REFRESH_DAYS ?? '30');
    const expiresAt = new Date(
      Date.now() + (Number.isFinite(days) ? days : 30) * 24 * 60 * 60_000,
    );

    const session = await this.sessionModel.create({
      clinicId: input.clinicId,
      userId: input.userId,
      branchId: input.branchId,
      refreshTokenHash: hash,
      expiresAt,
    });

    return {
      sessionId: session._id.toHexString(),
      refreshToken: raw,
      expiresAt,
    };
  }

  async login(input: {
    clinicId: string;
    email: string;
    password: string;
    branchId?: string;
  }) {
    const clinicId = new Types.ObjectId(input.clinicId);
    const email = input.email.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ clinicId, email })
      .select('+passwordHash');
    // Uniform error to prevent user enumeration: don't reveal whether the
    // account exists, is disabled, has no password, or has a wrong password.
    const invalid = new UnauthorizedException('Invalid credentials');
    if (!user) throw invalid;
    if (user.status !== UserStatus.Active) throw invalid;
    if (!user.passwordHash) throw invalid;

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw invalid;

    const effectiveBranchId = input.branchId ?? user.defaultBranchId?.toHexString();
    const claims: JwtClaims = {
      sub: user._id.toHexString(),
      clinicId: clinicId.toHexString(),
      branchId: effectiveBranchId,
    };

    const accessToken = await this.accessToken(claims);
    const refresh = await this.issueRefreshSession({
      clinicId,
      userId: user._id,
      branchId: effectiveBranchId ? new Types.ObjectId(effectiveBranchId) : undefined,
    });

    return {
      accessToken,
      refresh: {
        sessionId: refresh.sessionId,
        refreshToken: refresh.refreshToken,
        expiresAt: refresh.expiresAt,
      },
      userId: claims.sub,
      clinicId: claims.clinicId,
      branchId: claims.branchId ?? null,
    };
  }

  async refresh(input: { sessionId: string; refreshToken: string }) {
    if (!Types.ObjectId.isValid(input.sessionId)) {
      throw new UnauthorizedException('Invalid session');
    }
    const sessionId = new Types.ObjectId(input.sessionId);

    const session = await this.sessionModel.findById(sessionId);
    if (!session) throw new UnauthorizedException('Invalid session');
    if (session.revokedAt) throw new UnauthorizedException('Session revoked');
    if (session.expiresAt.getTime() <= Date.now())
      throw new UnauthorizedException('Session expired');

    const matchesCurrent = await bcrypt.compare(
      input.refreshToken,
      session.refreshTokenHash,
    );
    if (!matchesCurrent) {
      throw new UnauthorizedException('Invalid session');
    }

    // Atomic compare-and-swap: only the first concurrent caller for this
    // (sessionId, currentHash) wins. Late racers find the hash already rotated
    // and the predicate fails, so they get null back. We treat that as a
    // benign 401 ("Stale refresh") rather than corrupting the session.
    const guardHash = session.refreshTokenHash;
    const newRaw = crypto.randomBytes(32).toString('base64url');
    const newHash = await bcrypt.hash(newRaw, 10);

    const updated = await this.sessionModel.findOneAndUpdate(
      {
        _id: sessionId,
        refreshTokenHash: guardHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      },
      { $set: { refreshTokenHash: newHash } },
      { new: true },
    );

    if (!updated) {
      // Lost the race or session got revoked/expired between read and write.
      throw new UnauthorizedException('Stale refresh');
    }

    const claims: JwtClaims = {
      sub: updated.userId.toHexString(),
      clinicId: updated.clinicId.toHexString(),
      branchId: updated.branchId?.toHexString(),
    };
    const accessToken = await this.accessToken(claims);

    return {
      accessToken,
      refresh: {
        sessionId: updated._id.toHexString(),
        refreshToken: newRaw,
        expiresAt: updated.expiresAt,
      },
    };
  }

  async logout(input: { sessionId: string }) {
    await this.sessionModel.updateOne(
      { _id: new Types.ObjectId(input.sessionId) },
      { $set: { revokedAt: new Date() } },
    );
    return { ok: true };
  }

  /**
   * Re-issues an access token bound to a different branch in the same
   * clinic. The user must have the target branch in their `branchIds`
   * list — admins typically have all branches, clinicians one. The
   * refresh-session row is also updated so the new branch survives
   * future token rotations.
   *
   * Returns the new JWT plus the resolved branch identity so the FE
   * can update its local context atomically.
   */
  async switchBranch(input: {
    actorUserId: Types.ObjectId;
    clinicId: Types.ObjectId;
    sessionId: string;
    targetBranchId: string;
  }) {
    if (!Types.ObjectId.isValid(input.targetBranchId)) {
      throw new UnauthorizedException('Invalid branchId');
    }
    const targetBranchId = new Types.ObjectId(input.targetBranchId);

    const user = await this.userModel.findOne({
      _id: input.actorUserId,
      clinicId: input.clinicId,
    });
    if (!user) throw new UnauthorizedException('User not found in clinic');
    if (user.status !== UserStatus.Active) {
      throw new UnauthorizedException('User is not active');
    }

    const allowed = (user.branchIds ?? []).some((b) =>
      b.equals(targetBranchId),
    );
    if (!allowed) {
      throw new UnauthorizedException(
        'User is not assigned to the requested branch',
      );
    }

    const claims: JwtClaims = {
      sub: input.actorUserId.toHexString(),
      clinicId: input.clinicId.toHexString(),
      branchId: targetBranchId.toHexString(),
    };
    const accessToken = await this.accessToken(claims);

    // Persist on the session so the next /auth/refresh keeps the new
    // branch. Without this, an 8-hour token rotation would silently
    // reset the user to the JWT-baked branch.
    if (Types.ObjectId.isValid(input.sessionId)) {
      await this.sessionModel.updateOne(
        { _id: new Types.ObjectId(input.sessionId) },
        { $set: { branchId: targetBranchId } },
      );
    }

    return {
      accessToken,
      branchId: targetBranchId.toHexString(),
    };
  }
}
