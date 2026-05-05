import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { UpdateEncounterDto } from './dto/update-encounter.dto';
import { Encounter, EncounterStatus } from './schemas/encounter.schema';
import {
  Appointment,
  AppointmentStatus,
} from '../appointments/schemas/appointment.schema';

@Injectable()
export class EncountersService {
  constructor(
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
  ) {}

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
      // eslint-disable-next-line no-console
      console.log('[encounters.create] appointment lookup', {
        appointmentId: appointmentId.toHexString(),
        found: !!appt,
        currentStatus: appt?.status,
      });
      if (!appt) throw new NotFoundException('Appointment not found');

      // Check if a DRAFT encounter already exists for this appointment
      const existingDraft = await this.encounterModel.findOne({
        clinicId,
        appointmentId,
        status: EncounterStatus.Draft,
      });
      if (existingDraft) {
        // eslint-disable-next-line no-console
        console.log(
          '[encounters.create] returning existing draft',
          existingDraft._id,
        );
        return existingDraft;
      }

      if (appt.status === AppointmentStatus.CheckedIn) {
        appt.status = AppointmentStatus.InProgress;
        await appt.save();
        // eslint-disable-next-line no-console
        console.log('[encounters.create] flipped appointment to IN_PROGRESS');
      } else if (appt.status !== AppointmentStatus.InProgress) {
        throw new BadRequestException(
          `Cannot start an encounter for an appointment in status ${appt.status}; the appointment must be CHECKED_IN first`,
        );
      }
    }

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

    if (dto.chiefComplaint !== undefined)
      enc.chiefComplaint = dto.chiefComplaint;
    if (dto.notes !== undefined) enc.notes = dto.notes;
    if (dto.diagnosis !== undefined) enc.diagnosis = dto.diagnosis;
    if (dto.vitals !== undefined) enc.vitals = dto.vitals;
    if (dto.followUpAt !== undefined) {
      const d = dto.followUpAt ? new Date(dto.followUpAt) : undefined;
      if (d && isNaN(d.getTime()))
        throw new BadRequestException('Invalid followUpAt');
      enc.followUpAt = d;
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
    await enc.save();

    if (enc.appointmentId) {
      const appt = await this.apptModel.findOne({
        _id: enc.appointmentId,
        clinicId,
      });
      // eslint-disable-next-line no-console
      console.log('[encounters.sign] appointment lookup', {
        appointmentId: enc.appointmentId.toHexString(),
        found: !!appt,
        currentStatus: appt?.status,
      });
      if (appt && appt.status === AppointmentStatus.InProgress) {
        appt.status = AppointmentStatus.Done;
        await appt.save();
        // eslint-disable-next-line no-console
        console.log('[encounters.sign] flipped appointment to DONE');
      }
    }

    return enc;
  }

  async findByAppointment(clinicId: Types.ObjectId, appointmentId: string) {
    return await this.encounterModel.findOne({
      clinicId,
      appointmentId: new Types.ObjectId(appointmentId),
    });
  }
}
