import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PatientAccount,
  PatientAccountDocument,
  PatientAccountGender,
  PatientAccountStatus,
} from './schemas/patient-account.schema';
import {
  PatientLink,
  PatientLinkStatus,
  PatientLinkVia,
} from './schemas/patient-link.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { Clinic, ClinicStatus } from '../tenancy/schemas/clinic.schema';
import { normalizeName } from '../patients/patient.utils';
import {
  ageOn,
  dobMatches,
  phoneVariants,
  pickCandidate,
  storedDobIso,
} from './identity.utils';

export type ProfilePatch = {
  fullName?: string;
  dob?: string;
  gender?: PatientAccountGender;
  email?: string | null;
  bloodGroup?: string | null;
};

/** Upper bound on clinic records considered for one phone number. */
const MAX_PHONE_CANDIDATES = 200;

/** A link whose clinic currently takes part in the portal. */
export type VisibleLink = {
  linkId: Types.ObjectId;
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  clinicName: string;
  timezone: string;
  currency: string;
};

/** Approved clinic (legacy rows without a status count as active, as at sign-in). */
export function isClinicActive(clinic: {
  status?: ClinicStatus | null;
}): boolean {
  return (clinic.status ?? ClinicStatus.Active) === ClinicStatus.Active;
}

@Injectable()
export class PatientIdentitiesService {
  private readonly logger = new Logger(PatientIdentitiesService.name);

  constructor(
    @InjectModel(PatientAccount.name)
    private readonly accountModel: Model<PatientAccount>,
    @InjectModel(PatientLink.name)
    private readonly linkModel: Model<PatientLink>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  // --- Accounts ------------------------------------------------------------

  async findOrCreateLoginAccount(
    phone: string,
    dialCode: string,
  ): Promise<PatientAccountDocument> {
    const existing = await this.accountModel.findOne({ phone });
    if (existing) return existing;
    try {
      return await this.accountModel.create({ phone, dialCode });
    } catch (e: any) {
      // Two first logins racing for the same number: the unique index lets
      // one insert win; the other reads it back.
      if (e?.code === 11000) {
        const winner = await this.accountModel.findOne({ phone });
        if (winner) return winner;
      }
      throw e;
    }
  }

  /** An active account, or 401 (a disabled account's tokens stop working). */
  async getActiveAccount(
    accountId: Types.ObjectId | string,
  ): Promise<PatientAccountDocument> {
    const id =
      typeof accountId === 'string' ? accountId : accountId.toHexString();
    if (!Types.ObjectId.isValid(id))
      throw new UnauthorizedException('Invalid session');
    const account = await this.accountModel.findById(id);
    if (
      !account ||
      account.status !== PatientAccountStatus.Active ||
      !account.phone
    ) {
      throw new UnauthorizedException('Invalid session');
    }
    return account;
  }

  async getById(
    accountId: Types.ObjectId,
  ): Promise<PatientAccountDocument | null> {
    return this.accountModel.findById(accountId);
  }

  async findByIds(ids: Types.ObjectId[]): Promise<PatientAccountDocument[]> {
    if (!ids.length) return [];
    return this.accountModel.find({ _id: { $in: ids } });
  }

  async findLoginAccountByPhone(
    phone: string,
  ): Promise<PatientAccountDocument | null> {
    return this.accountModel.findOne({
      phone,
      status: PatientAccountStatus.Active,
    });
  }

  async markLogin(account: PatientAccountDocument): Promise<void> {
    await this.accountModel.updateOne(
      { _id: account._id },
      { $set: { lastLoginAt: new Date() } },
    );
  }

  /**
   * Update the person's own profile. The date of birth is what proves which
   * clinic records are theirs, so it is locked once any record is linked —
   * otherwise changing it would let someone claim a different record.
   */
  async updateProfile(
    account: PatientAccountDocument,
    patch: ProfilePatch,
  ): Promise<PatientAccountDocument> {
    if (patch.dob !== undefined && patch.dob !== account.dob) {
      this.assertValidDob(patch.dob);
      const linked = await this.linkModel.exists({
        accountId: account._id,
        status: PatientLinkStatus.Active,
      });
      if (linked && account.dob) {
        throw new BadRequestException(
          'Date of birth cannot be changed after clinic records are linked. Ask your clinic to correct it.',
        );
      }
      account.dob = patch.dob;
    }
    if (patch.fullName !== undefined) account.fullName = patch.fullName.trim();
    if (patch.gender !== undefined) account.gender = patch.gender;
    if (patch.email !== undefined)
      account.email = patch.email
        ? patch.email.trim().toLowerCase()
        : undefined;
    if (patch.bloodGroup !== undefined)
      account.bloodGroup = patch.bloodGroup || undefined;
    if (!account.profileCompletedAt && account.fullName && account.dob) {
      account.profileCompletedAt = new Date();
    }
    await account.save();
    return account;
  }

  async updatePrivacy(
    account: PatientAccountDocument,
    patch: { appLock?: boolean; hidePreviews?: boolean },
  ) {
    const set: Record<string, boolean> = {};
    if (typeof patch.appLock === 'boolean')
      set['privacy.appLock'] = patch.appLock;
    if (typeof patch.hidePreviews === 'boolean')
      set['privacy.hidePreviews'] = patch.hidePreviews;
    if (Object.keys(set).length)
      await this.accountModel.updateOne({ _id: account._id }, { $set: set });
  }

  async markNotificationsRead(account: PatientAccountDocument, ids?: string[]) {
    if (!ids) {
      await this.accountModel.updateOne(
        { _id: account._id },
        {
          $set: { notificationsReadAllAt: new Date(), readNotificationIds: [] },
        },
      );
      return;
    }
    const clean = ids
      .filter((i) => typeof i === 'string' && i.length <= 100)
      .slice(0, 100);
    await this.accountModel.updateOne(
      { _id: account._id },
      { $push: { readNotificationIds: { $each: clean, $slice: -500 } } },
    );
  }

  private assertValidDob(dob: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob))
      throw new BadRequestException('dob must be YYYY-MM-DD');
    const age = ageOn(dob);
    if (age === null || age < 0 || age > 130)
      throw new BadRequestException('Invalid date of birth');
  }

  // --- Dependants ----------------------------------------------------------

  /**
   * A child managed by the guardian. Limited to under-18s: an adult must
   * link their own account and choose what to share — managing them as a
   * dependant would bypass that consent.
   */
  async createDependant(
    guardian: PatientAccountDocument,
    input: {
      fullName: string;
      dob: string;
      gender?: PatientAccountGender;
      relation?: string;
    },
  ): Promise<PatientAccountDocument> {
    this.assertValidDob(input.dob);
    const age = ageOn(input.dob)!;
    if (age >= 18) {
      throw new BadRequestException(
        'Only children under 18 can be added as dependants. Invite adults to link their own account.',
      );
    }
    const count = await this.accountModel.countDocuments({
      managedByAccountId: guardian._id,
      status: PatientAccountStatus.Active,
    });
    if (count >= 10)
      throw new BadRequestException('You can manage at most 10 dependants');
    return this.accountModel.create({
      managedByAccountId: guardian._id,
      fullName: input.fullName.trim(),
      dob: input.dob,
      gender: input.gender,
      relation: input.relation?.trim(),
      dialCode: guardian.dialCode,
      profileCompletedAt: new Date(),
    });
  }

  async listDependants(
    guardianId: Types.ObjectId,
  ): Promise<PatientAccountDocument[]> {
    return this.accountModel
      .find({
        managedByAccountId: guardianId,
        status: PatientAccountStatus.Active,
      })
      .sort({ createdAt: 1 });
  }

  async getDependant(
    guardianId: Types.ObjectId,
    dependantId: string,
  ): Promise<PatientAccountDocument> {
    if (!Types.ObjectId.isValid(dependantId))
      throw new NotFoundException('Family member not found');
    const dep = await this.accountModel.findOne({
      _id: new Types.ObjectId(dependantId),
      managedByAccountId: guardianId,
      status: PatientAccountStatus.Active,
    });
    if (!dep) throw new NotFoundException('Family member not found');
    return dep;
  }

  /** Remove a dependant from the family. Their clinic records are untouched. */
  async removeDependant(
    guardianId: Types.ObjectId,
    dependantId: string,
  ): Promise<void> {
    const dep = await this.getDependant(guardianId, dependantId);
    dep.status = PatientAccountStatus.Disabled;
    await dep.save();
    await this.linkModel.updateMany(
      { accountId: dep._id, status: PatientLinkStatus.Active },
      { $set: { status: PatientLinkStatus.Revoked, revokedAt: new Date() } },
    );
  }

  // --- Links ---------------------------------------------------------------

  async activeLinks(
    accountId: Types.ObjectId,
  ): Promise<Array<PatientLink & { _id: Types.ObjectId }>> {
    return this.linkModel
      .find({ accountId, status: PatientLinkStatus.Active })
      .sort({ createdAt: 1 })
      .lean() as any;
  }

  /**
   * The account's links at clinics that are still approved. A suspended
   * clinic disappears without any link being changed. `portal.enabled` is
   * not required here: a verified mobile that matches a clinic chart is
   * enough to show that chart. The flag still gates public discovery and
   * online booking.
   */
  async visibleLinks(accountId: Types.ObjectId): Promise<VisibleLink[]> {
    const links = await this.activeLinks(accountId);
    if (!links.length) return [];
    const clinics = await this.clinicModel
      .find({ _id: { $in: links.map((l) => l.clinicId) } })
      .select({ name: 1, status: 1, timezone: 1, currency: 1 })
      .lean();
    const byId = new Map(clinics.map((c) => [String(c._id), c]));
    const out: VisibleLink[] = [];
    for (const l of links) {
      const c = byId.get(String(l.clinicId));
      if (!c || !isClinicActive(c)) continue;
      out.push({
        linkId: l._id,
        clinicId: l.clinicId,
        patientId: l.patientId,
        clinicName: c.name,
        timezone: c.timezone || 'UTC',
        currency: c.currency || 'INR',
      });
    }
    return out;
  }

  /** The account whose link owns this clinic record, if any. */
  async accountForPatient(
    clinicId: Types.ObjectId,
    patientId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const link = await this.linkModel
      .findOne({ clinicId, patientId, status: PatientLinkStatus.Active })
      .select({ accountId: 1 })
      .lean();
    return link?.accountId ?? null;
  }

  /**
   * The person's own record at a clinic, or null. When several charts share
   * the verified mobile (a child on a parent's number), prefer the one that
   * matches this account's name and date of birth. Never trusts a
   * client-sent patientId.
   */
  async resolveLink(accountId: Types.ObjectId, clinicId: Types.ObjectId) {
    const links = await this.linkModel
      .find({ accountId, clinicId, status: PatientLinkStatus.Active })
      .lean();
    if (links.length <= 1) return links[0] ?? null;

    const account = await this.accountModel
      .findById(accountId)
      .select({ fullName: 1, dob: 1 })
      .lean();
    const [patients, clinic] = await Promise.all([
      this.patientModel
        .find({ _id: { $in: links.map((l) => l.patientId) } })
        .select({ fullName: 1, normalizedName: 1, dob: 1 })
        .lean(),
      this.clinicModel.findById(clinicId).select({ timezone: 1 }).lean(),
    ]);
    const want = account?.fullName ? normalizeName(account.fullName) : '';
    let best: (typeof links)[number] | null = null;
    let bestScore = 0;
    for (const p of patients) {
      const dobOk =
        !!account?.dob &&
        dobMatches(p.dob as Date | undefined, account.dob, clinic?.timezone);
      const nameOk =
        !!want &&
        (p.normalizedName ?? normalizeName(p.fullName ?? '')) === want;
      const score = (dobOk ? 2 : 0) + (nameOk ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best =
          links.find((l) => String(l.patientId) === String(p._id)) ?? null;
      }
    }
    return best ?? links[0];
  }

  async revokeLink(accountId: Types.ObjectId, linkId: string): Promise<void> {
    if (!Types.ObjectId.isValid(linkId))
      throw new NotFoundException('Link not found');
    const res = await this.linkModel.updateOne(
      {
        _id: new Types.ObjectId(linkId),
        accountId,
        status: PatientLinkStatus.Active,
      },
      { $set: { status: PatientLinkStatus.Revoked, revokedAt: new Date() } },
    );
    if (!res.matchedCount) throw new NotFoundException('Link not found');
  }

  /** Record that the portal created this clinic record for the person. */
  async linkSelfRegistered(
    accountId: Types.ObjectId,
    clinicId: Types.ObjectId,
    patientId: Types.ObjectId,
  ) {
    return this.linkModel.create({
      accountId,
      clinicId,
      patientId,
      status: PatientLinkStatus.Active,
      linkedVia: PatientLinkVia.PortalSelfRegister,
      verifiedAt: new Date(),
    });
  }

  /**
   * Attach clinic charts to this account.
   *
   * A login account (verified mobile) gets every unclaimed chart that stores
   * that number, and its empty profile is filled from the chart so the
   * portal shows the patient's name and date of birth on first sign-in.
   * A dependant still matches the guardian's number AND the child's date of
   * birth, so adding a child does not pull in every chart on the number.
   *
   * Charts already claimed by another account are skipped. Safe to call
   * repeatedly; it runs on every login and profile save.
   */
  async syncLinks(account: PatientAccountDocument): Promise<number> {
    if (account.status !== PatientAccountStatus.Active) return 0;
    const dependant = !account.phone && !!account.managedByAccountId;
    const dependantDob = account.dob;
    if (dependant && !dependantDob) return 0;

    let phone = account.phone;
    if (!phone && account.managedByAccountId) {
      const guardian = await this.accountModel
        .findById(account.managedByAccountId)
        .select({ phone: 1, dialCode: 1 })
        .lean();
      phone = guardian?.phone;
      if (!account.dialCode && guardian?.dialCode)
        account.dialCode = guardian.dialCode;
    }
    if (!phone) return 0;

    const candidates = await this.patientModel
      .find({
        normalizedPhones: { $in: phoneVariants(phone, account.dialCode) },
      })
      .select({
        clinicId: 1,
        fullName: 1,
        normalizedName: 1,
        dob: 1,
        gender: 1,
      })
      .limit(MAX_PHONE_CANDIDATES)
      .lean();
    if (!candidates.length) return 0;

    const clinicIds = Array.from(
      new Set(candidates.map((c) => String(c.clinicId))),
    ).map((s) => new Types.ObjectId(s));
    const [clinics, ownLinks, claimed] = await Promise.all([
      this.clinicModel
        .find({ _id: { $in: clinicIds } })
        .select({ timezone: 1 })
        .lean(),
      this.linkModel
        .find({ accountId: account._id, status: PatientLinkStatus.Active })
        .select({ clinicId: 1 })
        .lean(),
      this.linkModel
        .find({
          patientId: { $in: candidates.map((c) => c._id) },
          status: PatientLinkStatus.Active,
        })
        .select({ patientId: 1 })
        .lean(),
    ]);
    const tzByClinic = new Map(clinics.map((c) => [String(c._id), c.timezone]));
    const claimedPatients = new Set(claimed.map((l) => String(l.patientId)));

    if (!dependant) {
      await this.fillProfileFromCharts(account, candidates, tzByClinic);
      return this.linkAll(account, candidates, claimedPatients);
    }

    // Dependant: guardian's number + this child's date of birth, one chart
    // per clinic, and only when the name is unambiguous.
    if (!dependantDob) return 0;
    const linkedClinics = new Set(ownLinks.map((l) => String(l.clinicId)));
    const byClinic = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const cid = String(c.clinicId);
      if (linkedClinics.has(cid) || claimedPatients.has(String(c._id)))
        continue;
      if (
        !dobMatches(c.dob as Date | undefined, dependantDob, tzByClinic.get(cid))
      )
        continue;
      byClinic.set(cid, [...(byClinic.get(cid) ?? []), c]);
    }

    let linked = 0;
    for (const [cid, matches] of byClinic) {
      const pick = pickCandidate(matches as any[], account.fullName);
      if (!pick) {
        this.logger.warn(
          `Ambiguous clinic records for account ${account._id.toHexString()} at clinic ${cid}; not linked`,
        );
        continue;
      }
      if (await this.insertLink(account, cid, pick._id, PatientLinkVia.PhoneDobConfirmed))
        linked += 1;
    }
    return linked;
  }

  /** Copy name, date of birth and gender onto a still-empty login profile. */
  private async fillProfileFromCharts(
    account: PatientAccountDocument,
    candidates: Array<{
      fullName?: string;
      dob?: Date;
      gender?: string;
      clinicId: Types.ObjectId;
    }>,
    tzByClinic: Map<string, string | undefined>,
  ) {
    if (account.fullName && account.dob && account.gender) return;
    const ranked = candidates
      .filter((c) => c.fullName?.trim())
      .map((c) => ({
        c,
        iso:
          storedDobIso(c.dob as Date | undefined, tzByClinic.get(String(c.clinicId))) ??
          '9999-99-99',
        name: c.fullName!.trim(),
      }))
      .sort((a, b) =>
        a.iso === b.iso ? b.name.length - a.name.length : a.iso < b.iso ? -1 : 1,
      );
    const source = ranked[0]?.c;
    if (!source) return;
    if (!account.fullName) account.fullName = source.fullName!.trim();
    if (!account.dob) {
      const iso = storedDobIso(
        source.dob as Date | undefined,
        tzByClinic.get(String(source.clinicId)),
      );
      if (iso) account.dob = iso;
    }
    if (!account.gender) {
      if (source.gender === 'FEMALE')
        account.gender = PatientAccountGender.Female;
      else if (source.gender === 'MALE')
        account.gender = PatientAccountGender.Male;
    }
    if (!account.profileCompletedAt && account.fullName && account.dob) {
      account.profileCompletedAt = new Date();
    }
    await account.save();
  }

  private async linkAll(
    account: PatientAccountDocument,
    candidates: Array<{ _id: Types.ObjectId; clinicId: Types.ObjectId }>,
    claimedPatients: Set<string>,
  ): Promise<number> {
    let linked = 0;
    for (const c of candidates) {
      if (claimedPatients.has(String(c._id))) continue;
      if (
        await this.insertLink(
          account,
          String(c.clinicId),
          c._id,
          PatientLinkVia.PhoneVerified,
        )
      ) {
        claimedPatients.add(String(c._id));
        linked += 1;
      }
    }
    return linked;
  }

  private async insertLink(
    account: PatientAccountDocument,
    clinicId: string,
    patientId: Types.ObjectId,
    via: PatientLinkVia,
  ): Promise<boolean> {
    try {
      await this.linkModel.create({
        accountId: account._id,
        clinicId: new Types.ObjectId(clinicId),
        patientId,
        status: PatientLinkStatus.Active,
        linkedVia: via,
        verifiedAt: new Date(),
      });
      return true;
    } catch (e: any) {
      if (e?.code !== 11000) throw e; // claimed concurrently — leave it
      return false;
    }
  }
}
