import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '../appointments/schemas/appointment.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { NotificationsService } from './notifications.service';
import {
  NotificationChannel,
  NotificationTemplate,
} from './schemas/notification-template.schema';
import { renderTemplate } from './template.utils';

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.Booked,
  AppointmentStatus.CheckedIn,
  AppointmentStatus.InProgress,
];

function parseWindowsMinutes(): number[] {
  const raw = process.env.REMINDER_WINDOWS_MINUTES ?? '1440,120';
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

@Injectable()
export class NotificationsScheduler {
  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(NotificationTemplate.name)
    private readonly templateModel: Model<NotificationTemplate>,
    private readonly notifications: NotificationsService,
  ) {}

  // Every 5 minutes
  @Cron('*/5 * * * *')
  async run() {
    const windows = parseWindowsMinutes();
    if (!windows.length) return;

    const now = Date.now();
    for (const minutes of windows) {
      const from = new Date(now + minutes * 60_000);
      const to = new Date(now + (minutes * 60_000 + 5 * 60_000)); // 5-min bucket

      const appts = await this.apptModel.find({
        type: AppointmentType.Time,
        status: { $in: ACTIVE_STATUSES },
        startAt: { $gte: from, $lt: to },
      });

      const patientIds = Array.from(
        new Set(appts.map((a) => a.patientId?.toHexString()).filter(Boolean)),
      );
      const patients = patientIds.length
        ? await this.patientModel.find(
            { _id: { $in: patientIds } },
            { phones: 1 },
          )
        : [];
      const phoneByPatientId = new Map<string, string>();
      for (const p of patients) {
        const phone = (p.phones ?? [])
          .map((x) => String(x).trim())
          .find(Boolean);
        if (phone) phoneByPatientId.set(p._id.toHexString(), phone);
      }

      // One template per clinic is fetched lazily per window based on appointments in this batch.
      // If multiple clinics exist in batch, we fallback to default text per appointment.
      const templateByClinicId = new Map<string, string>();

      for (const a of appts) {
        const patientPhone = phoneByPatientId.get(a.patientId.toHexString());
        if (!patientPhone) continue;

        const dedupeKey = `appt:${a._id.toHexString()}:reminder:${minutes}`;
        const clinicKey = a.clinicId.toHexString();
        let templateBody = templateByClinicId.get(clinicKey);
        if (templateBody === undefined) {
          const key = `appointment_reminder_${minutes}m`;
          const tpl = await this.templateModel.findOne({
            clinicId: a.clinicId,
            channel: NotificationChannel.Sms,
            key,
            active: true,
          });
          templateBody = tpl?.body ?? '';
          templateByClinicId.set(clinicKey, templateBody);
        }

        const fallback = `Reminder: appointment at ${a.startAt?.toISOString()}`;
        const body = templateBody
          ? renderTemplate(templateBody, {
              appointmentTime: a.startAt?.toISOString() ?? '',
              minutes: String(minutes),
            })
          : fallback;

        try {
          await this.notifications.enqueueSend({
            clinicId: a.clinicId,
            branchId: a.branchId,
            channel: NotificationChannel.Sms,
            to: patientPhone,
            body,
            dedupeKey,
          });
        } catch {
          // Duplicate key or enqueue failure: ignore to keep scheduler idempotent.
        }
      }
    }
  }
}
