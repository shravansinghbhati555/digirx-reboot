import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  Appointment,
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
} from './schemas/appointment.schema';
import { QueueCounter } from './schemas/queue-counter.schema';
import { AvailabilityService } from '../availability/availability.service';
import { DateTime } from 'luxon';
import { Clinic } from '../tenancy/schemas/clinic.schema';

const ACTIVE_TIME_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.Booked,
  AppointmentStatus.CheckedIn,
  AppointmentStatus.InProgress,
];

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(QueueCounter.name)
    private readonly counterModel: Model<QueueCounter>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectConnection() private readonly connection: Connection,
    private readonly availability: AvailabilityService,
  ) {}

  async create(
    clinicId: Types.ObjectId,
    actorUserId: Types.ObjectId | undefined,
    dto: CreateAppointmentDto,
  ) {
    const branchId = new Types.ObjectId(dto.branchId);
    const doctorId = new Types.ObjectId(dto.doctorId);
    const patientId = new Types.ObjectId(dto.patientId);
    const source = dto.source ?? AppointmentSource.FrontDesk;

    if (dto.type === AppointmentType.Time) {
      if (!dto.startAt || !dto.endAt)
        throw new BadRequestException(
          'startAt and endAt are required for TIME',
        );
      const startAt = new Date(dto.startAt);
      const endAt = new Date(dto.endAt);
      if (!(startAt instanceof Date) || isNaN(startAt.getTime()))
        throw new BadRequestException('Invalid startAt');
      if (!(endAt instanceof Date) || isNaN(endAt.getTime()))
        throw new BadRequestException('Invalid endAt');
      if (endAt <= startAt)
        throw new BadRequestException('endAt must be after startAt');

      // Enforce doctor availability (branch + clinic timezone)
      await this.availability.assertTimeSlotAllowed({
        clinicId,
        branchId,
        doctorUserId: doctorId,
        startAt,
        endAt,
      });

      // Conflict prevention for MongoDB: transactional overlap check.
      try {
        // Transactions require MongoDB replica set. If unavailable, fallback to non-transactional check.
        const session = await this.connection
          .startSession()
          .catch(() => null as any);
        if (session) {
          try {
            let created: Appointment | null = null;
            await session.withTransaction(async () => {
              const overlap = await this.apptModel
                .findOne({
                  clinicId,
                  branchId,
                  doctorId,
                  type: AppointmentType.Time,
                  status: { $in: ACTIVE_TIME_STATUSES },
                  startAt: { $lt: endAt },
                  endAt: { $gt: startAt },
                })
                .session(session);

              if (overlap) {
                throw new ConflictException('Time slot is already booked');
              }

              created = await this.apptModel
                .create(
                  [
                    {
                      clinicId,
                      branchId,
                      doctorId,
                      patientId,
                      type: AppointmentType.Time,
                      startAt,
                      endAt,
                      status: AppointmentStatus.Booked,
                      source,
                      notes: dto.notes,
                      createdBy: actorUserId,
                    },
                  ],
                  { session },
                )
                .then((docs) => docs[0]);
            });
            if (!created) throw new Error('Appointment not created');
            return created;
          } catch (e: any) {
            // fall back when transactions are not supported
            const msg = String(e?.message ?? '');
            if (!msg.includes('Transaction numbers are only allowed')) throw e;
          } finally {
            await session.endSession();
          }
        }

        const overlap = await this.apptModel.findOne({
          clinicId,
          branchId,
          doctorId,
          type: AppointmentType.Time,
          status: { $in: ACTIVE_TIME_STATUSES },
          startAt: { $lt: endAt },
          endAt: { $gt: startAt },
        });
        if (overlap) throw new ConflictException('Time slot is already booked');

        return await this.apptModel.create({
          clinicId,
          branchId,
          doctorId,
          patientId,
          type: AppointmentType.Time,
          startAt,
          endAt,
          status: AppointmentStatus.Booked,
          source,
          notes: dto.notes,
          createdBy: actorUserId,
        });
      } finally {
      }
    }

    if (dto.type === AppointmentType.Queue) {
      const queueDate = (dto.queueDate ?? '').trim();
      if (!queueDate)
        throw new BadRequestException('queueDate is required for QUEUE');

      try {
        const session = await this.connection
          .startSession()
          .catch(() => null as any);
        if (session) {
          try {
            let created: Appointment | null = null;
            await session.withTransaction(async () => {
              const counter = await this.counterModel.findOneAndUpdate(
                { clinicId, branchId, doctorId, queueDate },
                { $inc: { lastNumber: 1 } },
                { upsert: true, new: true, session },
              );

              const queueNumber = counter.lastNumber;
              created = await this.apptModel
                .create(
                  [
                    {
                      clinicId,
                      branchId,
                      doctorId,
                      patientId,
                      type: AppointmentType.Queue,
                      queueDate,
                      queueNumber,
                      status: AppointmentStatus.Booked,
                      source,
                      notes: dto.notes,
                      createdBy: actorUserId,
                    },
                  ],
                  { session },
                )
                .then((docs) => docs[0]);
            });
            if (!created) throw new Error('Appointment not created');
            return created;
          } catch (e: any) {
            const msg = String(e?.message ?? '');
            if (!msg.includes('Transaction numbers are only allowed')) throw e;
          } finally {
            await session.endSession();
          }
        }

        const counter = await this.counterModel.findOneAndUpdate(
          { clinicId, branchId, doctorId, queueDate },
          { $inc: { lastNumber: 1 } },
          { upsert: true, new: true },
        );
        const queueNumber = counter.lastNumber;
        return await this.apptModel.create({
          clinicId,
          branchId,
          doctorId,
          patientId,
          type: AppointmentType.Queue,
          queueDate,
          queueNumber,
          status: AppointmentStatus.Booked,
          source,
          notes: dto.notes,
          createdBy: actorUserId,
        });
      } finally {
      }
    }

    throw new BadRequestException('Unsupported appointment type');
  }

  async listByDate(
    clinicId: Types.ObjectId,
    branchId: string,
    date: string,
    doctorId?: string,
  ) {
    const bId = new Types.ObjectId(branchId);
    const dId = doctorId ? new Types.ObjectId(doctorId) : undefined;

    // TIME: match by startAt date range UTC day (placeholder); later: clinic timezone range.
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    return await this.apptModel
      .find({
        clinicId,
        branchId: bId,
        ...(dId ? { doctorId: dId } : {}),
        $or: [
          {
            type: AppointmentType.Time,
            startAt: { $gte: dayStart, $lte: dayEnd },
          },
          { type: AppointmentType.Queue, queueDate: date },
        ],
      })
      .sort({ startAt: 1, queueNumber: 1 });
  }

  async availableSlots(input: {
    clinicId: Types.ObjectId;
    branchId: string;
    doctorId: string;
    date: string;
  }) {
    const branchObjId = new Types.ObjectId(input.branchId);
    const doctorObjId = new Types.ObjectId(input.doctorId);

    const daySlots = await this.availability.getDaySlots({
      clinicId: input.clinicId,
      branchId: branchObjId,
      doctorUserId: doctorObjId,
      date: input.date,
    });

    if (!daySlots.slots.length) return daySlots;

    const clinic = await this.clinicModel.findById(input.clinicId);
    const tz = clinic?.timezone || daySlots.timezone || 'UTC';
    const day = DateTime.fromISO(input.date, { zone: tz });
    const dayStartUtc = day.startOf('day').toUTC().toJSDate();
    const dayEndUtc = day.endOf('day').toUTC().toJSDate();

    const booked = await this.apptModel.find({
      clinicId: input.clinicId,
      branchId: branchObjId,
      doctorId: doctorObjId,
      type: AppointmentType.Time,
      status: { $in: ACTIVE_TIME_STATUSES },
      startAt: { $gte: dayStartUtc, $lte: dayEndUtc },
    });

    const bookedSet = new Set(
      booked.map(
        (a) => `${a.startAt?.toISOString()}|${a.endAt?.toISOString()}`,
      ),
    );
    const slots = daySlots.slots.filter(
      (s) => !bookedSet.has(`${s.startAt}|${s.endAt}`),
    );
    return { ...daySlots, slots };
  }

  async update(
    clinicId: Types.ObjectId,
    id: string,
    dto: UpdateAppointmentDto,
  ) {
    const appt = await this.apptModel.findOne({ _id: id, clinicId });
    if (!appt) throw new NotFoundException('Appointment not found');

    // Reschedule TIME with conflict check
    if ((dto.startAt || dto.endAt) && appt.type !== AppointmentType.Time) {
      throw new BadRequestException(
        'Only TIME appointments can be rescheduled by startAt/endAt',
      );
    }

    if (appt.type === AppointmentType.Time && (dto.startAt || dto.endAt)) {
      const startAt = dto.startAt ? new Date(dto.startAt) : appt.startAt!;
      const endAt = dto.endAt ? new Date(dto.endAt) : appt.endAt!;
      if (endAt <= startAt)
        throw new BadRequestException('endAt must be after startAt');

      const overlap = await this.apptModel.findOne({
        _id: { $ne: appt._id },
        clinicId,
        branchId: appt.branchId,
        doctorId: appt.doctorId,
        type: AppointmentType.Time,
        status: { $in: ACTIVE_TIME_STATUSES },
        startAt: { $lt: endAt },
        endAt: { $gt: startAt },
      });
      if (overlap) throw new ConflictException('Time slot is already booked');

      appt.startAt = startAt;
      appt.endAt = endAt;
    }

    if (dto.status) {
      appt.status = dto.status;
    }
    if (dto.notes !== undefined) {
      appt.notes = dto.notes;
    }

    await appt.save();
    return appt;
  }

  async checkin(clinicId: Types.ObjectId, id: string) {
    const appt = await this.apptModel.findOne({ _id: id, clinicId });
    if (!appt) throw new NotFoundException('Appointment not found');
    if (appt.status === AppointmentStatus.Cancelled)
      throw new BadRequestException('Appointment is cancelled');
    appt.status = AppointmentStatus.CheckedIn;
    await appt.save();
    return appt;
  }
}
