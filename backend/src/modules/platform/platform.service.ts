import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Clinic, ClinicStatus } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { User } from '../authz/schemas/user.schema';
import { Session } from '../auth/schemas/session.schema';
import { ClinicMailService } from '../notifications/clinic-mail.service';

/**
 * Cross-tenant clinic administration for the DigiRx platform team.
 *
 * Every other service in this codebase filters by `clinicId`. This one
 * deliberately does not — it is the approval queue that decides which
 * clinics exist at all. Access is gated by `PlatformAdminGuard`, never by
 * a clinic permission.
 */
@Injectable()
export class PlatformService {
  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
    private readonly clinicMail: ClinicMailService,
  ) {}

  /**
   * Matches customer tenants only.
   *
   * The DigiRx team's own workspace lives in `clinics` because its admins
   * need a clinic to belong to, but it is not a customer: showing it in the
   * queue invites an operator to suspend the workspace they are signed in
   * through. `$ne: true` rather than `false` so the rows written before this
   * flag existed still match.
   */
  private static readonly CUSTOMER_CLINICS = { isPlatformClinic: { $ne: true } };

  /** Counts for the queue's tab badges. */
  async summary() {
    const rows = await this.clinicModel.aggregate<{ _id: string | null; count: number }>([
      { $match: PlatformService.CUSTOMER_CLINICS },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = {
      [ClinicStatus.Pending]: 0,
      [ClinicStatus.Active]: 0,
      [ClinicStatus.Rejected]: 0,
      [ClinicStatus.Suspended]: 0,
    };
    let total = 0;
    for (const row of rows) {
      // Clinics created before the status field existed count as active.
      const key = (row._id as ClinicStatus | null) ?? ClinicStatus.Active;
      counts[key] = (counts[key] ?? 0) + row.count;
      total += row.count;
    }
    return { counts, total };
  }

  async list(input: { status?: string; query?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const filter: Record<string, unknown> = { ...PlatformService.CUSTOMER_CLINICS };

    if (input.status && input.status !== 'ALL') {
      const status = this.parseStatus(input.status);
      filter.status =
        status === ClinicStatus.Active
          ? { $in: [ClinicStatus.Active, null] }
          : status;
    }

    if (input.query?.trim()) {
      const rx = new RegExp(this.escapeRegex(input.query.trim()), 'i');
      filter.$or = [{ name: rx }, { requestedByName: rx }, { requestedByEmail: rx }];
    }

    const clinics = await this.clinicModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const clinicIds = clinics.map((c) => c._id);
    const [branchCounts, userCounts] = await Promise.all([
      this.branchModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { clinicId: { $in: clinicIds } } },
        { $group: { _id: '$clinicId', count: { $sum: 1 } } },
      ]),
      this.userModel.aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { clinicId: { $in: clinicIds } } },
        { $group: { _id: '$clinicId', count: { $sum: 1 } } },
      ]),
    ]);

    const branchBy = new Map(branchCounts.map((b) => [b._id.toHexString(), b.count]));
    const userBy = new Map(userCounts.map((u) => [u._id.toHexString(), u.count]));

    return {
      rows: clinics.map((clinic) => ({
        _id: clinic._id.toHexString(),
        name: clinic.name,
        status: clinic.status ?? ClinicStatus.Active,
        countryCode: clinic.countryCode,
        timezone: clinic.timezone,
        currency: clinic.currency,
        requestedByName: clinic.requestedByName ?? null,
        requestedByEmail: clinic.requestedByEmail ?? null,
        statusReason: clinic.statusReason ?? null,
        statusChangedAt: clinic.statusChangedAt ?? null,
        createdAt: (clinic as { createdAt?: Date }).createdAt ?? null,
        branchCount: branchBy.get(clinic._id.toHexString()) ?? 0,
        userCount: userBy.get(clinic._id.toHexString()) ?? 0,
      })),
    };
  }

  /**
   * Approve a pending clinic so its staff can sign in, and tell them.
   *
   * The prior status is read first so an admin clicking Approve twice — or
   * approving an already-active clinic from the ALL tab — doesn't send the
   * "you're live" mail again. The mail is best-effort: `ClinicMailService`
   * swallows its own failures, so approval never depends on the mailer.
   */
  async approve(clinicId: string, actorUserId: Types.ObjectId) {
    const { result, before } = await this.setStatus(
      clinicId,
      ClinicStatus.Active,
      actorUserId,
    );

    const wasActive = (before.status ?? ClinicStatus.Active) === ClinicStatus.Active;
    if (!wasActive) {
      await this.clinicMail.sendClinicActivatedEmail({
        clinicId: result.clinicId,
        clinicName: result.name,
        adminName: before.requestedByName ?? undefined,
        adminEmail: before.requestedByEmail ?? undefined,
      });
    }

    return result;
  }

  /**
   * Reject a registration. Existing sessions are revoked as well — a clinic
   * that was active and is now rejected must not keep a live tab working.
   */
  async reject(clinicId: string, actorUserId: Types.ObjectId, reason?: string) {
    const { result } = await this.setStatus(
      clinicId,
      ClinicStatus.Rejected,
      actorUserId,
      reason,
    );
    await this.revokeSessions(result._id);
    return result;
  }

  /** Cut off an active clinic without deleting anything. */
  async suspend(clinicId: string, actorUserId: Types.ObjectId, reason?: string) {
    const { result } = await this.setStatus(
      clinicId,
      ClinicStatus.Suspended,
      actorUserId,
      reason,
    );
    await this.revokeSessions(result._id);
    return result;
  }

  /**
   * The one place a clinic's status changes.
   *
   * Reads the row first for two reasons: to refuse the platform's own
   * workspace, and to hand callers the previous status so `approve` can tell
   * a real activation from a repeat click. `result` is what the API returns;
   * `before` never leaves the service.
   */
  private async setStatus(
    clinicId: string,
    status: ClinicStatus,
    actorUserId: Types.ObjectId,
    reason?: string,
  ) {
    if (!Types.ObjectId.isValid(clinicId)) {
      throw new BadRequestException('Invalid clinic id');
    }

    const before = await this.clinicModel
      .findById(new Types.ObjectId(clinicId))
      .select({
        status: 1,
        isPlatformClinic: 1,
        requestedByName: 1,
        requestedByEmail: 1,
      })
      .lean();

    if (!before) throw new NotFoundException('Clinic not found');
    if (before.isPlatformClinic) {
      // Hidden from the queue, so this is either a stale tab or a crafted
      // request. Either way it must not go through: suspending the platform
      // workspace locks its own admins out of the console.
      throw new BadRequestException(
        'The DigiRx platform workspace is not a customer clinic — its status cannot be changed.',
      );
    }

    const clinic = await this.clinicModel.findByIdAndUpdate(
      new Types.ObjectId(clinicId),
      {
        $set: {
          status,
          statusChangedAt: new Date(),
          statusChangedByUserId: actorUserId,
          // Approving clears any earlier rejection note so the queue does not
          // keep showing a stale reason next to a live clinic.
          statusReason: status === ClinicStatus.Active ? null : (reason ?? null),
        },
      },
      { new: true },
    );

    if (!clinic) throw new NotFoundException('Clinic not found');

    return {
      result: {
        _id: clinic._id,
        clinicId: clinic._id.toHexString(),
        name: clinic.name,
        status: clinic.status,
        statusReason: clinic.statusReason ?? null,
        statusChangedAt: clinic.statusChangedAt ?? null,
      },
      before,
    };
  }

  /** Kill refresh sessions so access stops at the next rotation, not in 30 days. */
  private async revokeSessions(clinicId: Types.ObjectId) {
    await this.sessionModel.updateMany(
      { clinicId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  }

  private parseStatus(value: string): ClinicStatus {
    const upper = value.toUpperCase();
    const allowed = Object.values(ClinicStatus) as string[];
    if (!allowed.includes(upper)) {
      throw new BadRequestException(`Unknown clinic status: ${value}`);
    }
    return upper as ClinicStatus;
  }

  private escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
