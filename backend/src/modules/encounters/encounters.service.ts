import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { UpdateEncounterDto } from './dto/update-encounter.dto';
import { Encounter, EncounterStatus } from './schemas/encounter.schema';

@Injectable()
export class EncountersService {
  constructor(@InjectModel(Encounter.name) private readonly encounterModel: Model<Encounter>) {}

  async create(clinicId: Types.ObjectId, dto: CreateEncounterDto) {
    const branchId = new Types.ObjectId(dto.branchId);
    const doctorId = new Types.ObjectId(dto.doctorId);
    const patientId = new Types.ObjectId(dto.patientId);
    const appointmentId = dto.appointmentId ? new Types.ObjectId(dto.appointmentId) : undefined;

    const visitedAt = dto.visitedAt ? new Date(dto.visitedAt) : new Date();
    if (isNaN(visitedAt.getTime())) throw new BadRequestException('Invalid visitedAt');

    return await this.encounterModel.create({
      clinicId,
      branchId,
      doctorId,
      patientId,
      appointmentId,
      visitedAt,
      chiefComplaint: dto.chiefComplaint,
      status: EncounterStatus.Draft,
    });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.encounterModel.findOne({ _id: id, clinicId });
    if (!doc) throw new NotFoundException('Encounter not found');
    return doc;
  }

  async update(clinicId: Types.ObjectId, id: string, dto: UpdateEncounterDto) {
    const enc = await this.getById(clinicId, id);
    if (enc.status === EncounterStatus.Signed) {
      throw new BadRequestException('Encounter already signed');
    }

    if (dto.chiefComplaint !== undefined) enc.chiefComplaint = dto.chiefComplaint;
    if (dto.notes !== undefined) enc.notes = dto.notes;
    if (dto.diagnosis !== undefined) enc.diagnosis = dto.diagnosis;
    if (dto.vitals !== undefined) enc.vitals = dto.vitals;
    if (dto.followUpAt !== undefined) {
      const d = dto.followUpAt ? new Date(dto.followUpAt) : undefined;
      if (d && isNaN(d.getTime())) throw new BadRequestException('Invalid followUpAt');
      enc.followUpAt = d;
    }

    await enc.save();
    return enc;
  }

  async sign(clinicId: Types.ObjectId, id: string) {
    const enc = await this.getById(clinicId, id);
    enc.status = EncounterStatus.Signed;
    await enc.save();
    return enc;
  }
}

