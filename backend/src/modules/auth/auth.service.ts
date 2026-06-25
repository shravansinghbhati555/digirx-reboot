import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { Role } from '../authz/schemas/role.schema';
import { User, UserStatus } from '../authz/schemas/user.schema';
import { Permission } from '../authz/permissions';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { JwtClaims } from './auth.types';
import { Session } from './schemas/session.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
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

  /**
   * Bootstrap a new clinic + admin in one call. Creates Clinic, a default
   * Branch, an "Admin" Role with every Permission, and the admin User with
   * a bcrypt-hashed password. Auto-issues an access token + refresh session
   * so the caller can drop straight into the app like login does.
   *
   * Idempotency is intentionally NOT provided: a clinic with the same name
   * is allowed (clinics aren't unique by name in the schema), but the
   * (clinicId, email) compound index will block a duplicate admin inside
   * the same clinic.
   */
  async signup(input: {
    clinicName: string;
    branchName?: string;
    countryCode?: string;
    timezone?: string;
    currency?: string;
    phoneCountryCode?: string;
    adminName: string;
    adminEmail: string;
    password: string;
  }) {
    const timezone = input.timezone || 'Asia/Kolkata';
    if (!DateTime.local().setZone(timezone).isValid) {
      throw new BadRequestException(`Invalid IANA timezone: ${timezone}`);
    }
    const email = input.adminEmail.trim().toLowerCase();

    const clinic = await this.clinicModel.create({
      name: input.clinicName.trim(),
      countryCode: (input.countryCode || 'IN').toUpperCase(),
      timezone,
      currency: (input.currency || 'INR').toUpperCase(),
      phoneCountryCode: input.phoneCountryCode || '+91',
      settings: {},
    });

    const branch = await this.branchModel.create({
      clinicId: clinic._id,
      name: (input.branchName || 'Main').trim(),
      active: true,
    });

    // Seed the five default roles every clinic gets out of the box.
    // Only `Super Admin` is assigned to the signing-up user — the rest
    // are available to attach to other staff as the clinic onboards
    // them. `Super Admin` is the immutable / reserved role; the others
    // are normal roles whose permission lists can be tweaked later.
    const defaultRoles: Array<{ name: string; permissions: Permission[] }> = [
      // Full access — assigned to the signup user.
      {
        name: 'Super Admin',
        permissions: Object.values(Permission),
      },
      // Operational admin: runs day-to-day ops but can't change
      // clinic-level config or create / disable users.
      {
        name: 'Manager',
        permissions: [
          Permission.DashboardRead,
          Permission.ClinicRead,
          Permission.BranchRead,
          Permission.UserRead,
          // Managers create staff accounts and enroll/remove their face
          // login, so they need user:write (the face endpoints are gated
          // on it).
          Permission.UserWrite,
          Permission.PatientRead,
          Permission.PatientWrite,
          Permission.AppointmentRead,
          Permission.AppointmentWrite,
          Permission.BillingRead,
          Permission.BillingWrite,
          Permission.DocumentRead,
          Permission.DocumentWrite,
          Permission.NotificationRead,
          Permission.NotificationWrite,
          Permission.InventoryRead,
          Permission.InventoryWrite,
          Permission.AuditRead,
          Permission.AccessLogRead,
          Permission.ReportsRead,
          Permission.ReportsWrite,
          Permission.PharmacyRead,
          Permission.PharmacyWrite,
          Permission.EncounterRead,
          Permission.EncounterWrite,
          Permission.SettingsClinicRead,
          Permission.SettingsBranchesRead,
          Permission.SettingsAvailabilityRead,
          Permission.SettingsNotificationsRead,
          Permission.SettingsAuditRead,
        ],
      },
      // Patient-facing reception: registers patients, books appointments,
      // takes payments. Read-only on documents (no upload) and no
      // inventory access.
      {
        name: 'Front Desk',
        permissions: [
          Permission.DashboardRead,
          Permission.ClinicRead,
          Permission.BranchRead,
          Permission.UserRead,
          Permission.PatientRead,
          Permission.PatientWrite,
          Permission.AppointmentRead,
          Permission.AppointmentWrite,
          Permission.BillingRead,
          Permission.BillingWrite,
          Permission.DocumentRead,
          Permission.NotificationRead,
          Permission.SettingsAvailabilityRead,
        ],
      },
      // Clinicians: see and edit their patients, manage their own
      // appointments, upload encounter / prescription documents.
      // No billing write (front desk handles money) and no inventory.
      {
        // Default doctor: the four day-to-day tabs only — Availability,
        // Appointments, Consultations, Patients. This is just the DEFAULT;
        // a Manager / Super Admin can grant more (Billing, Reports, etc.)
        // from Roles & Permissions and those tabs then appear for the
        // doctor automatically.
        //   - ClinicRead/BranchRead: needed for availability + branch context
        //   - Patient*: Patients tab + register/edit
        //   - Appointment*: Appointments tab + book/check-in
        //   - Encounter*: Consultations tab
        //   - Document*: view/attach prescription docs (no Documents tab —
        //     doctors are blocklisted from that tab)
        //   - SettingsAvailabilityRead: the Availability tab
        name: 'Doctor',
        permissions: [
          Permission.ClinicRead,
          Permission.BranchRead,
          Permission.PatientRead,
          Permission.PatientWrite,
          Permission.AppointmentRead,
          Permission.AppointmentWrite,
          Permission.DocumentRead,
          Permission.DocumentWrite,
          Permission.EncounterRead,
          Permission.EncounterWrite,
          Permission.SettingsAvailabilityRead,
        ],
      },
      // Pharmacy: manages stock, dispenses medicines, raises pharmacy
      // bills. Reads prescription documents but doesn't edit patient
      // records and doesn't manage appointments.
      {
        name: 'Pharmacist',
        permissions: [
          Permission.DashboardRead,
          Permission.ClinicRead,
          Permission.BranchRead,
          Permission.PatientRead,
          Permission.BillingRead,
          Permission.BillingWrite,
          Permission.DocumentRead,
          Permission.InventoryRead,
          Permission.InventoryWrite,
          Permission.PharmacyRead,
          Permission.PharmacyWrite,
          Permission.NotificationRead,
          Permission.ReportsRead,
        ],
      },
    ];

    const createdRoles = await this.roleModel.insertMany(
      defaultRoles.map((r) => ({
        clinicId: clinic._id,
        name: r.name,
        permissions: r.permissions,
      })),
    );
    const adminRole = createdRoles.find((r) => r.name === 'Super Admin');
    if (!adminRole) {
      // Defensive: insertMany should have created the row; bail rather
      // than silently provisioning a user with no role.
      throw new Error('Failed to provision Super Admin role for new clinic');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    let user;
    try {
      user = await this.userModel.create({
        clinicId: clinic._id,
        branchIds: [branch._id],
        defaultBranchId: branch._id,
        email,
        name: input.adminName.trim(),
        status: UserStatus.Active,
        passwordHash,
        roleIds: [adminRole._id],
      });
    } catch (e) {
      // Unique-index collision on (clinicId, email) — extremely unlikely
      // for a brand-new clinic, but guard anyway so we don't leave a
      // half-formed tenant if a race somehow lands here.
      if ((e as { code?: number }).code === 11000) {
        throw new ConflictException('Email already in use in this clinic');
      }
      throw e;
    }

    const claims: JwtClaims = {
      sub: user._id.toHexString(),
      clinicId: clinic._id.toHexString(),
      branchId: branch._id.toHexString(),
    };
    const accessToken = await this.accessToken(claims);
    const refresh = await this.issueRefreshSession({
      clinicId: clinic._id,
      userId: user._id,
      branchId: branch._id,
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
      branchId: claims.branchId!,
      clinicName: clinic.name,
      branchName: branch.name,
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

    // Surface the user's role names so the FE can short-circuit
    // post-login UX (e.g. super-admins skip branch selection — they
    // have full cross-branch access already). Cheap: 1 indexed find
    // with no payload growth (names only).
    const roleDocs = user.roleIds?.length
      ? await this.roleModel
          .find({ _id: { $in: user.roleIds }, clinicId })
          .select({ name: 1 })
          .lean()
      : [];
    const roles = roleDocs.map((r) => r.name).filter(Boolean) as string[];

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
      roles,
    };
  }

  /**
   * Single-step login by email + password.
   *
   * Resolution rules:
   *   - email is unique per clinic (sparse index), NOT globally — the
   *     same admin@example.com could live in two clinics.
   *   - if exactly one active match: log in directly, using
   *     user.clinicId + user.defaultBranchId.
   *   - if multiple matches: throw a 409 with the candidate clinics
   *     so the FE can show a clinic picker (rare but possible).
   *   - if user has no defaultBranchId AND isn't a cross-branch role
   *     (Super Admin / Manager): refuse — admin needs to assign a
   *     branch from Users → Edit before this account can log in.
   */
  async loginByEmail(input: { email: string; password: string }) {
    const email = input.email.trim().toLowerCase();
    const invalid = new UnauthorizedException('Invalid credentials');

    // findOne candidates across all clinics. We don't filter by
    // status yet — that check is uniform-error below so attackers
    // can't tell "wrong password" from "account disabled".
    const candidates = await this.userModel
      .find({ email })
      .select('+passwordHash');

    if (candidates.length === 0) throw invalid;

    // If multiple users share the email across clinics, prompt the
    // FE to disambiguate. Returning the clinic list isn't sensitive
    // — clinics are listed on /clinics/search already.
    if (candidates.length > 1) {
      // Pick the subset where the password actually matches so we
      // don't return clinics the caller can't unlock.
      const verified: typeof candidates = [];
      for (const u of candidates) {
        if (!u.passwordHash) continue;
        if (u.status !== UserStatus.Active) continue;
        if (await bcrypt.compare(input.password, u.passwordHash)) {
          verified.push(u);
        }
      }
      if (verified.length === 0) throw invalid;
      if (verified.length === 1) {
        return this.completeLoginForUser(verified[0]);
      }
      // Still ambiguous — return picker payload.
      const clinics = await this.clinicModel
        .find({ _id: { $in: verified.map((u) => u.clinicId) } })
        .select({ _id: 1, name: 1 })
        .lean();
      throw new ConflictException({
        code: 'MULTIPLE_CLINICS',
        message: 'This email is registered with multiple clinics. Pick one to continue.',
        clinics: clinics.map((c) => ({ id: c._id.toHexString(), name: c.name })),
      });
    }

    const user = candidates[0];
    if (user.status !== UserStatus.Active) throw invalid;
    if (!user.passwordHash) throw invalid;
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw invalid;

    return this.completeLoginForUser(user);
  }

  /**
   * Issue a session for an already-authenticated user id. Used by the
   * face-login flow, where UserFaceService has already verified the
   * person's identity from a face scan — no password to check. Applies
   * the same branch rule + token issuance as email login.
   */
  async issueSessionForUser(userId: Types.ObjectId) {
    const user = await this.userModel.findById(userId);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (user.status !== UserStatus.Active) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.completeLoginForUser(user);
  }

  /**
   * Shared completion path for loginByEmail. Verifies the branch rule
   * (clinicians must have at least one branch; admins don't), mints
   * the access token, issues the refresh session, and returns the
   * same shape as `login`.
   */
  private async completeLoginForUser(user: any) {
    // Look up roles before issuing the token so we can apply the
    // branch-required rule role-by-role.
    const roleDocs = user.roleIds?.length
      ? await this.roleModel
          .find({ _id: { $in: user.roleIds }, clinicId: user.clinicId })
          .select({ name: 1 })
          .lean()
      : [];
    const roles = roleDocs.map((r) => r.name).filter(Boolean) as string[];
    const lowerRoles = roles.map((r) => r.toLowerCase());
    const isCrossBranch = lowerRoles.includes('super admin') || lowerRoles.includes('manager');

    // Prefer the explicit defaultBranchId, but fall back to the first
    // entry of branchIds when it's empty. That gracefully covers users
    // who were assigned a branch in the access-list (branchIds) without
    // having defaultBranchId stamped — common for accounts created or
    // edited before the Add User form started setting it automatically.
    let effectiveBranchId: string | undefined = user.defaultBranchId?.toHexString();
    if (!effectiveBranchId && Array.isArray(user.branchIds) && user.branchIds.length > 0) {
      effectiveBranchId = user.branchIds[0].toHexString();
    }
    if (!effectiveBranchId && !isCrossBranch) {
      // Closed loop: the Add User form should require a branch for
      // clinician roles. If we still hit this, the user has neither
      // a defaultBranchId nor any branchIds — admin needs to fix it.
      throw new BadRequestException(
        "Your account isn't fully set up. Ask the clinic admin to assign you a branch.",
      );
    }

    const claims: JwtClaims = {
      sub: user._id.toHexString(),
      clinicId: user.clinicId.toHexString(),
      branchId: effectiveBranchId,
    };
    const accessToken = await this.accessToken(claims);
    const refresh = await this.issueRefreshSession({
      clinicId: user.clinicId,
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
      roles,
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

  /**
   * Issue a one-time reset token for an admin account. Behaves identically
   * (200 ok, no error) regardless of whether the email exists, the account
   * is disabled, or the user lacks the Admin role — this is the only way
   * to avoid leaking which emails are registered admins via timing or
   * status-code differences.
   *
   * Admin gating means doctors / front-desk / pharmacist users can't
   * initiate a password reset on themselves — they have to ask an admin
   * (which goes through the existing POST /users/:id/password-reset).
   * Admins are detected by a role named "Super Admin" (case-insensitive),
   * matching what /auth/signup seeds. Older clinics seeded with the
   * legacy "Admin" name are also recognised so existing data keeps
   * working.
   *
   * The raw token is delivered out-of-band: in dev it's logged to the
   * server console; in prod this is the integration point for email
   * (TODO). Only the bcrypt hash is stored on the user document.
   */
  async forgotPassword(input: { clinicId: string; email: string }) {
    if (!Types.ObjectId.isValid(input.clinicId)) return { ok: true };
    const clinicId = new Types.ObjectId(input.clinicId);
    const email = input.email.trim().toLowerCase();

    const user = await this.userModel.findOne({ clinicId, email });
    if (!user) return { ok: true };
    if (user.status !== UserStatus.Active) return { ok: true };
    if (!user.roleIds?.length) return { ok: true };

    const roles = await this.roleModel.find({
      _id: { $in: user.roleIds },
      clinicId,
    });
    const isAdmin = roles.some((r) => {
      const n = (r.name ?? '').toLowerCase();
      return n === 'super admin' || n === 'admin';
    });
    if (!isAdmin) return { ok: true };

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = await bcrypt.hash(rawToken, 10);
    user.passwordResetTokenHash = tokenHash;
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60_000);
    await user.save();

    // TODO: deliver via email (Nodemailer / SES / SendGrid). For dev we
    // log the raw token so a developer can copy it into the reset form.
    // Never log this in production — gate on NODE_ENV before adding the
    // real email send so the log line goes away.
    // eslint-disable-next-line no-console
    console.warn(
      `[forgot-password] Reset token for ${email}: ${rawToken} (expires in 30 minutes)`,
    );

    return { ok: true };
  }

  /**
   * Consume a reset token and set a new password. Token is single-use:
   * verified against the stored bcrypt hash, then both token fields are
   * cleared atomically with the new password hash. Every refresh session
   * for the user is revoked so any device that was still holding a token
   * is logged out.
   */
  async resetPasswordWithToken(input: {
    clinicId: string;
    email: string;
    token: string;
    newPassword: string;
  }) {
    if (!Types.ObjectId.isValid(input.clinicId)) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    const clinicId = new Types.ObjectId(input.clinicId);
    const email = input.email.trim().toLowerCase();

    const user = await this.userModel
      .findOne({ clinicId, email })
      .select('+passwordResetTokenHash +passwordResetExpiresAt');

    const invalid = new UnauthorizedException('Invalid or expired token');
    if (!user) throw invalid;
    if (user.status !== UserStatus.Active) throw invalid;
    if (!user.passwordResetTokenHash || !user.passwordResetExpiresAt) {
      throw invalid;
    }
    if (user.passwordResetExpiresAt.getTime() <= Date.now()) throw invalid;

    const ok = await bcrypt.compare(input.token, user.passwordResetTokenHash);
    if (!ok) throw invalid;

    user.passwordHash = await bcrypt.hash(input.newPassword, 10);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpiresAt = undefined;
    await user.save();

    // Logs out every device — the password just changed, the user has to
    // sign in again everywhere with the new credentials.
    await this.sessionModel.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );

    return { ok: true };
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
