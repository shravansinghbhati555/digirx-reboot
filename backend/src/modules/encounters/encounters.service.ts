import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { createHash } from 'crypto';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { UpdateEncounterDto } from './dto/update-encounter.dto';
import {
  Encounter,
  EncounterStatus,
  type DiagnosisItem,
} from './schemas/encounter.schema';
import { EncounterCounter } from './schemas/encounter-counter.schema';
import {
  Appointment,
  AppointmentStatus,
} from '../appointments/schemas/appointment.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';

@Injectable()
export class EncountersService implements OnModuleInit {
  private readonly logger = new Logger(EncountersService.name);

  constructor(
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(EncounterCounter.name)
    private readonly counterModel: Model<EncounterCounter>,
    @InjectModel(Clinic.name)
    private readonly clinicModel: Model<Clinic>,
  ) { }

  async onModuleInit() {
    await this.backfillMissingReadableIds();
  }

  async backfillMissingReadableIds() {
    const missing = await this.encounterModel.find({
      readableId: { $exists: false },
    });
    if (missing.length === 0) return;

    this.logger.log(`Backfilling readableId for ${missing.length} encounters...`);
    for (const enc of missing) {
      const rid = await this.mintReadableId(enc.clinicId);
      await this.encounterModel.updateOne(
        { _id: enc._id },
        { $set: { readableId: rid } },
      );
    }
    this.logger.log('Backfill complete.');
  }

  async create(clinicId: Types.ObjectId, dto: CreateEncounterDto) {
    const branchId = new Types.ObjectId(dto.branchId);
    const doctorId = new Types.ObjectId(dto.doctorId);
    const patientId = new Types.ObjectId(dto.patientId);
    const appointmentId = dto.appointmentId
      ? new Types.ObjectId(dto.appointmentId)
      : undefined;

    const visitedAt = dto.visitedAt ? new Date(dto.visitedAt) : new Date();
    if (isNaN(visitedAt.getTime()))
      throw new BadRequestException('Invalid visitedAt');

    if (appointmentId) {
      const appt = await this.apptModel.findOne({
        _id: appointmentId,
        clinicId,
      });
      if (!appt) throw new NotFoundException('Appointment not found');

      const existingDraft = await this.encounterModel.findOne({
        clinicId,
        appointmentId,
        status: EncounterStatus.Draft,
      });
      if (existingDraft) {
        return existingDraft;
      }

      if (appt.status === AppointmentStatus.CheckedIn) {
        appt.status = AppointmentStatus.InProgress;
        await appt.save();
      } else if (appt.status !== AppointmentStatus.InProgress) {
        throw new BadRequestException(
          `Cannot start an encounter for an appointment in status ${appt.status}; the appointment must be CHECKED_IN first`,
        );
      }
    }

    const readableId = await this.mintReadableId(clinicId);

    return await this.encounterModel.create({
      clinicId,
      branchId,
      doctorId,
      patientId,
      appointmentId,
      visitedAt,
      chiefComplaint: dto.chiefComplaint,
      status: EncounterStatus.Draft,
      readableId,
    });
  }

  private async mintReadableId(clinicId: Types.ObjectId): Promise<string> {
    const counter = await this.counterModel.findOneAndUpdate(
      { clinicId },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    );
    return `ENC-${String(counter.lastNumber).padStart(6, '0')}`;
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.encounterModel
      .findOne({ _id: id, clinicId })
      .populate('patientId', 'fullName mrn');
    if (!doc) throw new NotFoundException('Encounter not found');
    return doc;
  }

  async update(clinicId: Types.ObjectId, id: string, dto: UpdateEncounterDto) {
    const enc = await this.getById(clinicId, id);
    if (enc.status === EncounterStatus.Signed) {
      // 409: the resource is in a state that doesn't permit this mutation.
      // 400 was misleading — the payload may have been perfectly valid.
      throw new ConflictException('Encounter is signed and cannot be edited');
    }

    if (dto.chiefComplaint !== undefined)
      enc.chiefComplaint = dto.chiefComplaint;
    if (dto.notes !== undefined) enc.notes = dto.notes;
    if (dto.diagnosis !== undefined) enc.diagnosis = dto.diagnosis;
    if (dto.diagnoses !== undefined) {
      enc.diagnoses = normalizeDiagnoses(dto.diagnoses);
    }
    if (dto.vitals !== undefined) enc.vitals = dto.vitals;
    if (dto.followUpAt !== undefined) {
      const d = dto.followUpAt ? new Date(dto.followUpAt) : undefined;
      if (d && isNaN(d.getTime()))
        throw new BadRequestException('Invalid followUpAt');
      enc.followUpAt = d;
    }
    if (dto.followUpNotes !== undefined) {
      enc.followUpNotes = dto.followUpNotes.trim() || undefined;
    }

    await enc.save();
    return enc;
  }

  async sign(
    clinicId: Types.ObjectId,
    id: string,
    actorUserId: Types.ObjectId | undefined,
  ) {
    const enc = await this.getById(clinicId, id);
    if (enc.status === EncounterStatus.Signed) return enc;

    enc.status = EncounterStatus.Signed;
    enc.signedAt = new Date();
    enc.signedByUserId = actorUserId;
    enc.signedHash = computeSignedHash(enc);
    await enc.save();

    if (enc.appointmentId) {
      const appt = await this.apptModel.findOne({
        _id: enc.appointmentId,
        clinicId,
      });
      if (appt && appt.status === AppointmentStatus.InProgress) {
        appt.status = AppointmentStatus.Done;
        await appt.save();
      }
    }

    return enc;
  }

  async findByAppointment(clinicId: Types.ObjectId, appointmentId: string) {
    return await this.encounterModel
      .findOne({
        clinicId,
        appointmentId: new Types.ObjectId(appointmentId),
      })
      .populate('patientId', 'fullName mrn');
  }

  async findAll(
    clinicId: Types.ObjectId,
    query: { branchId?: string; date?: string; limit?: number; offset?: number; patientId?: string; },

  ) {
    const filter: any = { clinicId };
    if (query.branchId) filter.branchId = new Types.ObjectId(query.branchId);
    if (query.patientId) filter.patientId = new Types.ObjectId(query.patientId);

    // Date filter — `date=YYYY-MM-DD` is interpreted in the clinic's local
    // timezone and applied to `visitedAt`. Lets the global header date
    // narrow the list to "encounters seen on this day".
    if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      const clinic = await this.clinicModel.findById(clinicId);
      const tz = clinic?.timezone || 'UTC';
      const day = DateTime.fromISO(query.date, { zone: tz });
      if (day.isValid) {
        filter.visitedAt = {
          $gte: day.startOf('day').toUTC().toJSDate(),
          $lte: day.endOf('day').toUTC().toJSDate(),
        };
      }
    }

    const limit = Number(query.limit) || 20;
    const offset = Number(query.offset) || 0;

    return await this.encounterModel
      .find(filter)
      .sort({ visitedAt: -1 })
      .skip(offset)
      .limit(limit)
      .populate('patientId', 'fullName mrn')
      .lean();
  }
}

function normalizeDiagnoses(items: DiagnosisItem[]): DiagnosisItem[] {
  if (!items.length) return [];
  // Roadmap requires `primary: boolean` per item but real consumers expect
  // exactly one primary diagnosis for billing. If callers send multiple
  // primaries, keep the first; if they send none, mark the first item primary.
  let seenPrimary = false;
  const out = items.map((item) => {
    const trimmedDescription = item.description.trim();
    const code = item.code?.trim();
    const primary = item.primary && !seenPrimary;
    if (item.primary && !seenPrimary) seenPrimary = true;
    return {
      code: code || undefined,
      description: trimmedDescription,
      primary,
    };
  });
  if (!seenPrimary) out[0].primary = true;
  return out;
}

/**
 * Canonical SHA-256 of clinical content at sign time. The payload is
 * deterministic — we sort object keys and stringify with no whitespace —
 * so a verifier can recompute it from the stored fields and detect any
 * post-sign mutation.
 */
function computeSignedHash(enc: Encounter): string {
  const canonical = JSON.stringify(
    {
      clinicId: String(enc.clinicId),
      patientId: String(enc.patientId),
      doctorId: String(enc.doctorId),
      visitedAt: enc.visitedAt?.toISOString(),
      chiefComplaint: enc.chiefComplaint ?? null,
      notes: enc.notes ?? null,
      diagnosis: enc.diagnosis ?? null,
      diagnoses: (enc.diagnoses ?? []).map((d) => ({
        code: d.code ?? null,
        description: d.description,
        primary: d.primary,
      })),
      vitals: enc.vitals ?? null,
      followUpAt: enc.followUpAt?.toISOString() ?? null,
      followUpNotes: enc.followUpNotes ?? null,
    },
    Object.keys({}).sort(),
  );
  return createHash('sha256').update(canonical).digest('hex');
}
