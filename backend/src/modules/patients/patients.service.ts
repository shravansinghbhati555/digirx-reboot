import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient, PatientGender } from './schemas/patient.schema';
import {
  PatientIdentifier,
  PatientIdentifierType,
} from './schemas/patient-identifier.schema';
import { MrnCounter } from './schemas/mrn-counter.schema';
import { normalizeName, normalizePhone, phoneticOf } from './patient.utils';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { Encounter } from '../encounters/schemas/encounter.schema';
import { Bill } from '../billing/schemas/bill.schema';
import { Payment } from '../billing/schemas/payment.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { User } from '../authz/schemas/user.schema';
import { Prescription } from '../prescriptions/schemas/prescription.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import { StorageService } from '../storage/storage.service';
import { clientIdFields } from '../offline/client-id.util';

function dedupeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw).trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export type PatientCreateResult =
  | { duplicateCandidate: true; existing: Patient[]; created: null }
  | { duplicateCandidate: false; existing: never[]; created: Patient };

@Injectable()
export class PatientsService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(PatientIdentifier.name)
    private readonly identifierModel: Model<PatientIdentifier>,
    @InjectModel(MrnCounter.name)
    private readonly mrnCounterModel: Model<MrnCounter>,
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Prescription.name)
    private readonly rxModel: Model<Prescription>,
    private readonly storage: StorageService,
  ) { }

  async create(
    clinicId: Types.ObjectId,
    dto: CreatePatientDto,
    opts: { force?: boolean } = {},
  ): Promise<PatientCreateResult> {
    const fullName = (dto.fullName ?? '').trim();
    if (!fullName) {
      throw new BadRequestException('fullName is required');
    }

    const phones = (dto.phones ?? [])
      .map((p) => String(p).trim())
      .filter(Boolean);
    const normalizedPhones = Array.from(
      new Set(phones.map(normalizePhone).filter(Boolean)),
    );
    const emails = (dto.emails ?? [])
      .map((e) => String(e).trim().toLowerCase())
      .filter(Boolean);
    const normalizedName = normalizeName(fullName);
    const namePhonetic = phoneticOf(fullName);

    if (!opts.force) {
      const candidates = await this.findDuplicateCandidates(clinicId, {
        normalizedName,
        normalizedPhones,
      });
      if (candidates.length) {
        return {
          duplicateCandidate: true,
          existing: candidates,
          created: null,
        };
      }
    }

    const patient = await this.patientModel.create({
      ...clientIdFields(dto._id),
      clinicId,
      primaryBranchId: dto.primaryBranchId
        ? new Types.ObjectId(dto.primaryBranchId)
        : undefined,
      fullName,
      normalizedName,
      namePhonetic,
      gender: dto.gender ?? PatientGender.Male,
      dob: dto.dob ? new Date(dto.dob) : undefined,
      phones,
      normalizedPhones,
      countryCode: dto.countryCode,
      emails,
      tags: dedupeTags(dto.tags),
      notes: dto.notes,
    });

    // Mint an MRN and persist a PatientIdentifier row of type=MRN. The MRN is
    // also cached on the patient document for fast list rendering.
    const mrn = await this.mintMrn(clinicId);
    try {
      await this.identifierModel.create({
        clinicId,
        patientId: patient._id,
        type: PatientIdentifierType.MRN,
        value: mrn,
      });
      patient.mrn = mrn;
      await patient.save();
    } catch (err: any) {
      // Highly unlikely — the MRN counter is per-clinic and monotonic — but
      // if a manually-created identifier collides we surface a 409 rather
      // than leaving a half-created patient.
      if (err?.code === 11000) {
        throw new ConflictException('Generated MRN collides with an existing identifier');
      }
      throw err;
    }

    return { duplicateCandidate: false, existing: [], created: patient };
  }

  async update(clinicId: Types.ObjectId, id: string, dto: UpdatePatientDto) {
    const patient = await this.getById(clinicId, id);

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (!fullName) throw new BadRequestException('fullName cannot be empty');
      patient.fullName = fullName;
      patient.normalizedName = normalizeName(fullName);
      patient.namePhonetic = phoneticOf(fullName);
    }

    if (dto.phones !== undefined) {
      const phones = dto.phones.map((p) => String(p).trim()).filter(Boolean);
      patient.phones = phones;
      patient.normalizedPhones = Array.from(
        new Set(phones.map(normalizePhone).filter(Boolean)),
      );
    }

    if (dto.emails !== undefined) {
      patient.emails = dto.emails
        .map((e) => String(e).trim().toLowerCase())
        .filter(Boolean);
    }

    if (dto.gender !== undefined) patient.gender = dto.gender;
    if (dto.dob !== undefined) {
      const d = new Date(dto.dob);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid dob');
      patient.dob = d;
    }
    if (dto.primaryBranchId !== undefined) {
      patient.primaryBranchId = new Types.ObjectId(dto.primaryBranchId);
    }
    if (dto.tags !== undefined) patient.tags = dedupeTags(dto.tags);
    if (dto.notes !== undefined) patient.notes = dto.notes;
    if (dto.countryCode !== undefined) {
      (patient as unknown as { countryCode?: string }).countryCode = dto.countryCode;
    }
    if (dto.faceConsent !== undefined) {
      // Stamp the consent timestamp on the leading edge (false → true).
      // Revoking (true → false) leaves the historical timestamp alone so
      // we can audit when the consent originally lived.
      const wasConsented = (patient as unknown as { faceConsent?: boolean }).faceConsent === true;
      (patient as unknown as { faceConsent: boolean }).faceConsent = dto.faceConsent;
      if (dto.faceConsent && !wasConsented) {
        (patient as unknown as { faceConsentAt?: Date }).faceConsentAt = new Date();
      }
    }

    await patient.save();
    return patient;
  }

  /**
   * Patient timeline. Returns three arrays (appointments, encounters,
   * bills) each enriched with the names + counts the FE actually wants
   * to render — operators don't read ObjectIds.
   *
   * Enrichments:
   *   - Appointments + encounters get `doctorName` + `branchName`.
   *   - Encounters get a `prescriptions` summary (id + item count).
   *   - Bills get `totalPaid` and `outstanding` derived from payments.
   *
   * One round-trip per related collection rather than N+1 — three
   * parallel base fetches, then a single $in lookup per name source.
   */
  async getHistory(clinicId: Types.ObjectId, id: string) {
    const patient = await this.getById(clinicId, id);
    const patientId = patient._id;

    const [appointments, encounters, bills] = await Promise.all([
      this.apptModel
        .find({ clinicId, patientId })
        .sort({ startAt: -1, queueDate: -1, createdAt: -1 })
        .limit(100)
        .lean(),
      this.encounterModel
        .find({ clinicId, patientId })
        .sort({ visitedAt: -1 })
        .limit(100)
        .lean(),
      this.billModel
        .find({ clinicId, patientId })
        .sort({ issuedAt: -1, createdAt: -1 })
        .limit(100)
        .lean(),
    ]);

    // Collect IDs for one batched lookup per source.
    const doctorIdSet = new Set<string>();
    const branchIdSet = new Set<string>();
    for (const a of appointments) {
      doctorIdSet.add(String(a.doctorId));
      branchIdSet.add(String(a.branchId));
    }
    for (const e of encounters) {
      doctorIdSet.add(String(e.doctorId));
      branchIdSet.add(String(e.branchId));
    }
    for (const b of bills) {
      branchIdSet.add(String(b.branchId));
    }
    const doctorIds = Array.from(doctorIdSet).map((s) => new Types.ObjectId(s));
    const branchIds = Array.from(branchIdSet).map((s) => new Types.ObjectId(s));
    const billIds = bills.map((b) => b._id);
    const encounterIds = encounters.map((e) => e._id);

    const [doctors, branches, paymentTotals, prescriptions] = await Promise.all([
      doctorIds.length
        ? this.userModel
          .find({ clinicId, _id: { $in: doctorIds } }, { name: 1 })
          .lean()
        : Promise.resolve([]),
      branchIds.length
        ? this.branchModel
          .find({ clinicId, _id: { $in: branchIds } }, { name: 1 })
          .lean()
        : Promise.resolve([]),
      billIds.length
        ? this.paymentModel.aggregate<{ _id: Types.ObjectId; totalPaid: number }>([
          { $match: { clinicId, billId: { $in: billIds } } },
          { $group: { _id: '$billId', totalPaid: { $sum: '$amount' } } },
        ])
        : Promise.resolve([]),
      encounterIds.length
        ? this.rxModel
          .find(
            { clinicId, encounterId: { $in: encounterIds } },
            { encounterId: 1, items: 1, createdAt: 1 },
          )
          .lean()
        : Promise.resolve([]),
    ]);

    const doctorNameById = new Map(
      doctors.map((d) => [String(d._id), d.name]),
    );
    const branchNameById = new Map(
      branches.map((b) => [String(b._id), b.name]),
    );
    const totalPaidByBill = new Map(
      paymentTotals.map((p) => [String(p._id), p.totalPaid]),
    );
    const rxByEncounter = new Map<string, Array<{ _id: Types.ObjectId; itemCount: number; createdAt?: Date }>>();
    for (const rx of prescriptions) {
      const key = String(rx.encounterId);
      const arr = rxByEncounter.get(key) ?? [];
      arr.push({
        _id: rx._id,
        itemCount: Array.isArray(rx.items) ? rx.items.length : 0,
        createdAt: (rx as any).createdAt,
      });
      rxByEncounter.set(key, arr);
    }

    return {
      patientId,
      appointments: appointments.map((a) => ({
        ...a,
        doctorName: doctorNameById.get(String(a.doctorId)) ?? null,
        branchName: branchNameById.get(String(a.branchId)) ?? null,
      })),
      encounters: encounters.map((e) => ({
        ...e,
        doctorName: doctorNameById.get(String(e.doctorId)) ?? null,
        branchName: branchNameById.get(String(e.branchId)) ?? null,
        prescriptions: rxByEncounter.get(String(e._id)) ?? [],
      })),
      bills: bills.map((b) => {
        const totalPaid = totalPaidByBill.get(String(b._id)) ?? 0;
        return {
          ...b,
          branchName: branchNameById.get(String(b.branchId)) ?? null,
          totalPaid,
          outstanding: Math.max(0, (b.total ?? 0) - totalPaid),
        };
      }),
    };
  }

  async search(
    clinicId: Types.ObjectId,
    input: { query?: string; limit?: number; before?: string; branchId?: string },
  ) {
    const limit = Math.max(1, Math.min(100, input.limit ?? 25));
    const q = (input.query ?? '').trim();

    // Branch scoping is permissive: include patients whose
    // `primaryBranchId` matches the requested branch AND patients with
    // no primary branch set (legacy / clinic-wide patients). Without
    // the missing-field branch, switching branches would hide every
    // patient registered before primaryBranchId rolled out.
    const branchClause = (() => {
      if (!input.branchId) return null;
      if (!Types.ObjectId.isValid(input.branchId)) return null;
      const branchObj = new Types.ObjectId(input.branchId);
      return {
        $or: [
          { primaryBranchId: branchObj },
          { primaryBranchId: { $exists: false } },
          { primaryBranchId: null },
        ],
      };
    })();

    if (!q) {
      const filter: Record<string, unknown> = { clinicId };
      if (branchClause) Object.assign(filter, branchClause);
      if (input.before) {
        const d = new Date(input.before);
        if (!isNaN(d.getTime()))
          (filter as any).createdAt = { $lt: d };
      }
      return await this.patientModel
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit);
    }

    const normalized = normalizeName(q);
    const phoneLike = normalizePhone(q);
    const phonetic = phoneticOf(q);

    // Three-tier ranking: exact (regex on normalizedName) > phonetic > nothing.
    // We over-fetch a small window per tier and de-duplicate by _id so the
    // highest-quality match for each patient wins.
    //
    // Mongo can have at most one top-level $or, so when a branch clause
    // is in play we wrap both filters inside $and: [matchClause, branchClause].
    const matchClause = {
      $or: [
        { normalizedName: { $regex: normalized, $options: 'i' } },
        ...(phoneLike ? [{ normalizedPhones: phoneLike }] : []),
        ...(phoneLike ? [{ phones: phoneLike }] : []),
        ...(/^MRN[-_]/i.test(q) || /^[A-Z0-9-]+$/i.test(q)
          ? [{ mrn: q.toUpperCase() }]
          : []),
      ],
    };
    const exactFilter: Record<string, unknown> = branchClause
      ? { clinicId, $and: [matchClause, branchClause] }
      : { clinicId, ...matchClause };
    if (input.before) {
      const d = new Date(input.before);
      if (!isNaN(d.getTime())) {
        (exactFilter as any).createdAt = { $lt: d };
      }
    }

    const exact = await this.patientModel
      .find(exactFilter)
      .sort({ createdAt: -1 })
      .limit(limit);

    if (exact.length >= limit || !phonetic) return exact;

    const seen = new Set(exact.map((p) => String(p._id)));
    const phoneticTokens = phonetic.split(' ').filter(Boolean);
    if (!phoneticTokens.length) return exact;

    const phoneticBase: Record<string, unknown> = {
      _id: { $nin: Array.from(seen).map((s) => new Types.ObjectId(s)) },
      namePhonetic: { $regex: phoneticTokens.join('|') },
    };
    const phoneticFilter: Record<string, unknown> = branchClause
      ? { clinicId, $and: [phoneticBase, branchClause] }
      : { clinicId, ...phoneticBase };
    const fuzzy = await this.patientModel
      .find(phoneticFilter)
      .sort({ createdAt: -1 })
      .limit(limit - exact.length);

    return [...exact, ...fuzzy];
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.patientModel.findOne({ _id: id, clinicId });
    if (!doc) throw new NotFoundException('Patient not found');
    return doc;
  }

  /**
   * Mint a short-lived presigned GET URL for the patient's profile
   * picture (captured at face enrollment). Returns `null` if no image
   * is on file or presigning fails — the FE Avatar component falls
   * back to initials in that case. Called from the controller layer
   * so internal `getById` users still get a Mongoose Document they
   * can `.save()` on.
   */
  async presignProfileImage(patient: { profileImageKey?: string } | null): Promise<string | null> {
    const key = patient?.profileImageKey;
    if (!key) return null;
    try {
      return await this.storage.presignGet({ key, expiresInSeconds: 900 });
    } catch {
      return null;
    }
  }

  // --- Identifiers --------------------------------------------------------

  async listIdentifiers(clinicId: Types.ObjectId, patientId: string) {
    await this.getById(clinicId, patientId); // 404 if patient not in tenant
    return await this.identifierModel
      .find({ clinicId, patientId: new Types.ObjectId(patientId) })
      .sort({ createdAt: -1 });
  }

  async addIdentifier(
    clinicId: Types.ObjectId,
    patientId: string,
    type: PatientIdentifierType,
    value: string,
  ) {
    await this.getById(clinicId, patientId);
    const trimmed = value.trim();
    if (!trimmed) throw new BadRequestException('value is required');

    let row;
    try {
      row = await this.identifierModel.create({
        clinicId,
        patientId: new Types.ObjectId(patientId),
        type,
        value: trimmed,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `An identifier with type=${type} and value=${trimmed} already exists`,
        );
      }
      throw err;
    }

    if (type === PatientIdentifierType.MRN) {
      // Keep the cached `mrn` field in sync so list rendering doesn't need
      // a join. We don't unset it on MRN delete because removing your only
      // MRN is rare and operators usually want the historical value visible.
      await this.patientModel.updateOne(
        { _id: patientId, clinicId },
        { $set: { mrn: trimmed } },
      );
    }
    return row;
  }

  async removeIdentifier(
    clinicId: Types.ObjectId,
    patientId: string,
    identifierId: string,
  ) {
    if (!Types.ObjectId.isValid(identifierId)) {
      throw new NotFoundException('Identifier not found');
    }
    const result = await this.identifierModel.findOneAndDelete({
      _id: identifierId,
      clinicId,
      patientId: new Types.ObjectId(patientId),
    });
    if (!result) throw new NotFoundException('Identifier not found');
    return { ok: true as const, removed: result };
  }

  // --- Internals ----------------------------------------------------------

  private async findDuplicateCandidates(
    clinicId: Types.ObjectId,
    input: { normalizedName: string; normalizedPhones: string[] },
  ): Promise<Patient[]> {
    const phoneClauses = input.normalizedPhones.length
      ? [{ normalizedPhones: { $in: input.normalizedPhones } }]
      : [];
    const filter = {
      clinicId,
      $or: [
        { normalizedName: input.normalizedName },
        ...phoneClauses,
      ],
    };
    if (!filter.$or.length) return [];
    return await this.patientModel.find(filter).limit(5);
  }

  private async mintMrn(clinicId: Types.ObjectId): Promise<string> {
    const clinic = await this.clinicModel.findById(clinicId);
    const settings = mergeClinicSettings(clinic?.settings);
    const counter = await this.mrnCounterModel.findOneAndUpdate(
      { clinicId },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    );
    return formatMrn(settings.patients.mrnFormat, {
      seq: counter.lastNumber,
      clinicId,
    });
  }
}

function formatMrn(
  format: string,
  ctx: { seq: number; clinicId: Types.ObjectId },
): string {
  const now = new Date();
  return format
    .replace(/\{seq(?::(\d+))?\}/g, (_m, widthStr: string | undefined) => {
      const width = widthStr ? Number(widthStr) : 6;
      return String(ctx.seq).padStart(width, '0');
    })
    .replace(/\{YYYY\}/g, String(now.getUTCFullYear()))
    .replace(/\{YY\}/g, String(now.getUTCFullYear() % 100).padStart(2, '0'))
    .replace(/\{clinicCode\}/g, ctx.clinicId.toHexString().slice(0, 4).toUpperCase());
}
