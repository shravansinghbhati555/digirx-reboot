import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  Appointment,
  AppointmentStatus,
  AppointmentType,
} from '../appointments/schemas/appointment.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { User } from '../authz/schemas/user.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import { NotificationsService } from './notifications.service';
import {
  NotificationChannel,
  NotificationTemplate,
} from './schemas/notification-template.schema';
import { isWithinQuietHours } from './quiet-hours';
import { renderTemplate } from './template.utils';

const ACTIVE_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.Booked,
  AppointmentStatus.CheckedIn,
  AppointmentStatus.InProgress,
];

const BUCKET_MS = 5 * 60_000;

function parseWindowsMinutes(): number[] {
  const raw = process.env.REMINDER_WINDOWS_MINUTES ?? '1440,120';
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

@Injectable()
export class NotificationsScheduler {
  private readonly logger = new Logger(NotificationsScheduler.name);

  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(NotificationTemplate.name)
    private readonly templateModel: Model<NotificationTemplate>,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('*/5 * * * *')
  async run() {
    const windows = parseWindowsMinutes();
    if (!windows.length) {
      this.logger.debug('No reminder windows configured; skipping run.');
      return;
    }

    // Align the bucket to the start of the current minute. Cron fires a few ms
    // after the minute mark, and using raw Date.now() would shift the bucket
    // forward by those ms — appointments starting exactly on a minute boundary
    // would fall just below `$gte: from` and silently miss the reminder.
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    this.logger.log(
      `Reminder cron fired @ ${new Date(now).toISOString()}; windows=[${windows.join(',')}]m`,
    );

    for (const minutes of windows) {
      try {
        await this.runWindow(now, minutes);
      } catch (err) {
        this.logger.error(
          `Window ${minutes}m crashed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  private async runWindow(now: number, minutes: number) {
    const from = new Date(now + minutes * 60_000);
    const to = new Date(now + minutes * 60_000 + BUCKET_MS);

    const appts = await this.apptModel.find({
      type: AppointmentType.Time,
      status: { $in: ACTIVE_STATUSES },
      startAt: { $gte: from, $lt: to },
    });

    if (!appts.length) {
      this.logger.log(
        `[${minutes}m] no appointments in [${from.toISOString()} .. ${to.toISOString()})`,
      );
      return;
    }

    const patientIds = uniqueIds(appts.map((a) => a.patientId));
    const doctorIds = uniqueIds(appts.map((a) => a.doctorId));
    const clinicIds = uniqueIds(appts.map((a) => a.clinicId));
    const branchIds = uniqueIds(appts.map((a) => a.branchId));

    const [patients, doctors, clinics, branches] = await Promise.all([
      this.patientModel.find(
        { _id: { $in: patientIds } },
        { fullName: 1, phones: 1 },
      ),
      this.userModel.find({ _id: { $in: doctorIds } }, { name: 1 }),
      this.clinicModel.find(
        { _id: { $in: clinicIds } },
        { name: 1, timezone: 1 },
      ),
      this.branchModel.find({ _id: { $in: branchIds } }, { name: 1 }),
    ]);

    const patientById = byId(patients);
    const doctorById = byId(doctors);
    const clinicById = byId(clinics);
    const branchById = byId(branches);

    const templateKey = `appointment_reminder_${minutes}m`;
    const templateByClinic = new Map<string, string | null>();

    let enqueued = 0;
    let skippedNoPhone = 0;
    let skippedDup = 0;
    let skippedQuiet = 0;
    let failed = 0;

    for (const a of appts) {
      const apptId = a._id.toHexString();
      try {
        const patient = patientById.get(a.patientId.toHexString());
        const phone = (patient?.phones ?? [])
          .map((x) => String(x).trim())
          .find(Boolean);
        if (!phone) {
          skippedNoPhone += 1;
          this.logger.warn(
            `[${minutes}m] appt=${apptId} skipped: patient has no phone`,
          );
          continue;
        }

        const clinic = clinicById.get(a.clinicId.toHexString());
        const branch = branchById.get(a.branchId.toHexString());
        const doctor = doctorById.get(a.doctorId.toHexString());

        const tz = clinic?.timezone || 'UTC';

        // Quiet hours: skip reminders that would fire during the clinic's
        // configured quiet window. The cron runs every 5 min, so once the
        // window ends the next firing window will pick up reminders that
        // are still in their target band.
        const settings = mergeClinicSettings(clinic?.settings);
        if (
          isWithinQuietHours(
            new Date(now),
            tz,
            settings.modules.notifications.quietHours,
          )
        ) {
          skippedQuiet += 1;
          continue;
        }
        const startLocal = a.startAt
          ? DateTime.fromJSDate(a.startAt).setZone(tz)
          : null;
        const appointmentTime = startLocal ? startLocal.toFormat('h:mm a') : '';
        const appointmentDate = startLocal
          ? startLocal.toFormat('cccc, dd LLL')
          : '';

        const clinicKey = a.clinicId.toHexString();
        if (!templateByClinic.has(clinicKey)) {
          const tpl = await this.templateModel.findOne({
            clinicId: a.clinicId,
            channel: NotificationChannel.Sms,
            key: templateKey,
            active: true,
          });
          templateByClinic.set(clinicKey, tpl?.body ?? null);
        }
        const templateBody = templateByClinic.get(clinicKey) ?? null;

        const vars: Record<string, string> = {
          patientName: patient?.fullName ?? '',
          doctorName: doctor?.name ? `Dr. ${doctor.name}` : '',
          clinicName: clinic?.name ?? '',
          branchName: branch?.name ?? '',
          appointmentTime,
          appointmentDate,
          minutes: String(minutes),
        };

        const body = templateBody
          ? renderTemplate(templateBody, vars)
          : buildFallback(vars);

        try {
          await this.notifications.enqueueSend({
            clinicId: a.clinicId,
            branchId: a.branchId,
            channel: NotificationChannel.Sms,
            to: phone,
            body,
            dedupeKey: `appt:${apptId}:reminder:${minutes}`,
            templateKey: templateBody ? templateKey : undefined,
          });
          enqueued += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('E11000') || msg.includes('duplicate key')) {
            skippedDup += 1;
          } else {
            failed += 1;
            this.logger.warn(
              `[${minutes}m] appt=${apptId} enqueue failed: ${msg}`,
            );
          }
        }
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `[${minutes}m] appt=${apptId} processing error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(
      `[${minutes}m] matched=${appts.length} enqueued=${enqueued} skippedNoPhone=${skippedNoPhone} skippedDup=${skippedDup} skippedQuiet=${skippedQuiet} failed=${failed}`,
    );
  }
}

function buildFallback(v: Record<string, string>): string {
  const parts = [`Hi ${v.patientName || 'there'},`, 'reminder:'];
  if (v.appointmentDate) parts.push(`appointment on ${v.appointmentDate}`);
  if (v.appointmentTime) parts.push(`at ${v.appointmentTime}`);
  if (v.doctorName) parts.push(`with ${v.doctorName}`);
  if (v.clinicName) parts.push(`— ${v.clinicName}`);
  return parts.join(' ').replace(/\s+/g, ' ').trim() + '.';
}

function uniqueIds(ids: Types.ObjectId[]): Types.ObjectId[] {
  const seen = new Set<string>();
  const out: Types.ObjectId[] = [];
  for (const id of ids) {
    if (!id) continue;
    const k = id.toHexString();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(id);
  }
  return out;
}

function byId<T extends { _id: Types.ObjectId }>(docs: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const d of docs) m.set(d._id.toHexString(), d);
  return m;
}
