import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePatientDto } from './dto/create-patient.dto';
import { Patient, PatientGender } from './schemas/patient.schema';
import { normalizeName, normalizePhone } from './patient.utils';

@Injectable()
export class PatientsService {
  constructor(
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
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
      tags: dto.tags ?? [],
      notes: dto.notes,
    });

    return patient;
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
