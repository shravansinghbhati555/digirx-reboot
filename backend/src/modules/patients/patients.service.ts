import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { Patient, PatientGender } from './schemas/patient.schema';
import { normalizeName, normalizePhone } from './patient.utils';
import { Appointment } from '../appointments/schemas/appointment.schema';
import { Encounter } from '../encounters/schemas/encounter.schema';
import { Bill } from '../billing/schemas/bill.schema';

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

@Injectable()
export class PatientsService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
  ) {}

  async create(clinicId: Types.ObjectId, dto: CreatePatientDto) {
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

    const patient = await this.patientModel.create({
      clinicId,
      primaryBranchId: dto.primaryBranchId
        ? new Types.ObjectId(dto.primaryBranchId)
        : undefined,
      fullName,
      normalizedName: normalizeName(fullName),
      gender: dto.gender ?? PatientGender.Unknown,
      dob: dto.dob ? new Date(dto.dob) : undefined,
      phones,
      normalizedPhones,
      emails,
      tags: dedupeTags(dto.tags),
      notes: dto.notes,
    });

    return patient;
  }

  async update(
    clinicId: Types.ObjectId,
    id: string,
    dto: UpdatePatientDto,
  ) {
    const patient = await this.getById(clinicId, id);

    if (dto.fullName !== undefined) {
      const fullName = dto.fullName.trim();
      if (!fullName) throw new BadRequestException('fullName cannot be empty');
      patient.fullName = fullName;
      patient.normalizedName = normalizeName(fullName);
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

    await patient.save();
    return patient;
  }

  async getHistory(clinicId: Types.ObjectId, id: string) {
    const patient = await this.getById(clinicId, id);
    const patientId = patient._id;

    const [appointments, encounters, bills] = await Promise.all([
      this.apptModel
        .find({ clinicId, patientId })
        .sort({ startAt: -1, queueDate: -1, createdAt: -1 })
        .limit(100),
      this.encounterModel
        .find({ clinicId, patientId })
        .sort({ visitedAt: -1 })
        .limit(100),
      this.billModel
        .find({ clinicId, patientId })
        .sort({ issuedAt: -1, createdAt: -1 })
        .limit(100),
    ]);

    return { patientId, appointments, encounters, bills };
  }

  async search(
    clinicId: Types.ObjectId,
    input: { query?: string; limit?: number; before?: string },
  ) {
    const limit = Math.max(1, Math.min(100, input.limit ?? 25));
    const q = (input.query ?? '').trim();
    if (!q) {
      const filter: any = { clinicId };
      if (input.before) {
        const d = new Date(input.before);
        if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
      }
      return await this.patientModel
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit);
    }

    const normalized = normalizeName(q);
    const phoneLike = normalizePhone(q);
    const filter: any = {
      clinicId,
      $or: [
        { normalizedName: { $regex: normalized, $options: 'i' } },
        phoneLike ? { normalizedPhones: phoneLike } : undefined,
      ].filter(Boolean),
    };
    if (input.before) {
      const d = new Date(input.before);
      if (!isNaN(d.getTime())) filter.createdAt = { $lt: d };
    }

    return await this.patientModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.patientModel.findOne({ _id: id, clinicId });
    if (!doc) throw new NotFoundException('Patient not found');
    return doc;
  }
}
