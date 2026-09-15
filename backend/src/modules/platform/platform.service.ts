import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Clinic, ClinicStatus } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { User } from '../authz/schemas/user.schema';
import { Session } from '../auth/schemas/session.schema';

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
  ) {}

  /** Counts for the queue's tab badges. */
  async summary() {
    const rows = await this.clinicModel.aggregate<{ _id: string | null; count: number }>([
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
    const filter: Record<string, unknown> = {};

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

  /** Approve a pending clinic so its staff can sign in. */
  async approve(clinicId: string, actorUserId: Types.ObjectId) {
    return this.setStatus(clinicId, ClinicStatus.Active, actorUserId);
  }

  /**
   * Reject a registration. Existing sessions are revoked as well — a clinic
   * that was active and is now rejected must not keep a live tab working.
   */
  async reject(clinicId: string, actorUserId: Types.ObjectId, reason?: string) {
    const out = await this.setStatus(clinicId, ClinicStatus.Rejected, actorUserId, reason);
    await this.revokeSessions(out._id);
    return out;
  }

  /** Cut off an active clinic without deleting anything. */
  async suspend(clinicId: string, actorUserId: Types.ObjectId, reason?: string) {
    const out = await this.setStatus(clinicId, ClinicStatus.Suspended, actorUserId, reason);
    await this.revokeSessions(out._id);
    return out;
  }

  private async setStatus(
    clinicId: string,
    status: ClinicStatus,
    actorUserId: Types.ObjectId,
    reason?: string,
  ) {
    if (!Types.ObjectId.isValid(clinicId)) {
      throw new BadRequestException('Invalid clinic id');
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
      _id: clinic._id,
      clinicId: clinic._id.toHexString(),
      name: clinic.name,
      status: clinic.status,
      statusReason: clinic.statusReason ?? null,
      statusChangedAt: clinic.statusChangedAt ?? null,
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
