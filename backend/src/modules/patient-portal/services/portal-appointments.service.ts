import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  Appointment,
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
} from '../../appointments/schemas/appointment.schema';
import { AppointmentsService } from '../../appointments/appointments.service';
import { PatientsService } from '../../patients/patients.service';
import { PatientGender } from '../../patients/schemas/patient.schema';
import { BillingService } from '../../billing/billing.service';
import { Bill, BillStatus } from '../../billing/schemas/bill.schema';
import { Payment, PaymentMethod } from '../../billing/schemas/payment.schema';
import { VisitType } from '../../visit-types/schemas/visit-type.schema';
import {
  Encounter,
  EncounterStatus,
} from '../../encounters/schemas/encounter.schema';
import { RecordAccessService } from '../../record-access/record-access.service';
import { RecordAccessSource } from '../../record-access/schemas/record-access-grant.schema';
import { PatientIdentitiesService } from '../../patient-identities/patient-identities.service';
import { PatientAccountGender } from '../../patient-identities/schemas/patient-account.schema';
import { phoneVariants } from '../../patient-identities/identity.utils';
import { AuditAction } from '../../audit/schemas/audit-log.schema';
import {
  PortalDirectoryService,
  type BranchInfo,
} from './portal-directory.service';
import {
  PortalScopeService,
  type Subject,
  type SubjectLink,
} from './portal-scope.service';
import { PortalAuditService } from './portal-audit.service';
import { touch, type PortalCtx } from '../portal.context';
import { parseClockTime, toAppointmentView } from '../views/portal.mappers';
import type { PortalAppointmentView } from '../views/portal-view.types';

/** Statuses that hold a slot / count as an upcoming visit. */
const UPCOMING = [
  AppointmentStatus.Booked,
  AppointmentStatus.CheckedIn,
  AppointmentStatus.InProgress,
];

const GENDER_TO_PATIENT: Record<PatientAccountGender, PatientGender> = {
  [PatientAccountGender.Female]: PatientGender.Female,
  [PatientAccountGender.Male]: PatientGender.Male,
  // The clinic record only has MALE/FEMALE; the clinic can correct it.
  [PatientAccountGender.Other]: PatientGender.Male,
};

@Injectable()
export class PortalAppointmentsService {
  private readonly logger = new Logger(PortalAppointmentsService.name);

  constructor(
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(VisitType.name)
    private readonly visitTypeModel: Model<VisitType>,
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    private readonly appointments: AppointmentsService,
    private readonly patients: PatientsService,
    private readonly billing: BillingService,
    private readonly recordAccess: RecordAccessService,
    private readonly identities: PatientIdentitiesService,
    private readonly directory: PortalDirectoryService,
    private readonly scope: PortalScopeService,
    private readonly audit: PortalAuditService,
  ) {}

  // --- Read ----------------------------------------------------------------

  /** Appointments of everyone the caller may book for, newest first. */
  async list(
    ctx: PortalCtx,
    links?: SubjectLink[],
  ): Promise<PortalAppointmentView[]> {
    const all = links ?? (await this.scope.links(ctx, 'book'));
    if (!all.length) return [];
    const appts = await this.apptModel
      .find({
        $or: all.map((l) => ({ clinicId: l.clinicId, patientId: l.patientId })),
      })
      .sort({ startAt: -1, queueDate: -1, createdAt: -1 })
      .limit(300)
      .lean();
    return this.toViews(ctx, appts, all);
  }

  private async toViews(
    ctx: PortalCtx,
    appts: any[],
    links: SubjectLink[],
  ): Promise<PortalAppointmentView[]> {
    if (!appts.length) return [];
    const linkFor = (a: any) =>
      links.find(
        (l) => l.clinicId.equals(a.clinicId) && l.patientId.equals(a.patientId),
      )!;
    const billIds = appts.map((a) => a.billId).filter(Boolean);
    const vtIds = appts.map((a) => a.visitTypeId).filter(Boolean);
    const [bills, payments, vts, encounters, branches] = await Promise.all([
      billIds.length
        ? this.billModel
            .find({ _id: { $in: billIds } })
            .select({ total: 1, status: 1 })
            .lean()
        : [],
      billIds.length
        ? this.paymentModel
            .find({ billId: { $in: billIds } })
            .select({ billId: 1, method: 1 })
            .lean()
        : [],
      vtIds.length
        ? this.visitTypeModel
            .find({ _id: { $in: vtIds } })
            .select({ name: 1, price: 1 })
            .lean()
        : [],
      this.encounterModel
        .find({
          appointmentId: { $in: appts.map((a) => a._id) },
          status: EncounterStatus.Signed,
        })
        .select({ appointmentId: 1 })
        .lean(),
      this.directory.branches(
        [...new Set(appts.map((a) => String(a.branchId)))].map(
          (s) => new Types.ObjectId(s),
        ),
      ),
    ]);
    const billBy = new Map(bills.map((b: any) => [String(b._id), b]));
    const vtBy = new Map(vts.map((v: any) => [String(v._id), v]));
    const encBy = new Map(
      encounters.map((e: any) => [String(e.appointmentId), String(e._id)]),
    );
    const branchBy = new Map(branches.map((b) => [String(b.branchId), b]));
    const onlineBills = new Set(
      payments
        .filter(
          (p: any) =>
            p.method === PaymentMethod.Online ||
            p.method === PaymentMethod.Upi ||
            p.method === PaymentMethod.Card,
        )
        .map((p: any) => String(p.billId)),
    );

    return appts
      .map((a) => {
        const link = linkFor(a);
        if (!link) return null;
        touch(ctx, a.clinicId);
        const br = branchBy.get(String(a.branchId));
        const tz = link.timezone;
        const bill = a.billId ? billBy.get(String(a.billId)) : undefined;
        const vt = a.visitTypeId ? vtBy.get(String(a.visitTypeId)) : undefined;
        return toAppointmentView({
          appt: a,
          subjectId: link.subject.account._id.toHexString(),
          branchId: String(a.branchId),
          tz,
          today: DateTime.now().setZone(tz).toISODate()!,
          shortName: br?.clinicName ?? link.clinicName,
          fee: bill?.total ?? vt?.price ?? 0,
          title: vt?.name,
          paidOnline: !!bill && onlineBills.has(String(bill._id)),
          visitId: encBy.get(String(a._id)),
          invoiceId:
            bill && bill.status !== BillStatus.Draft
              ? String(bill._id)
              : undefined,
        });
      })
      .filter(Boolean) as PortalAppointmentView[];
  }

  /** One appointment the caller may manage, with its link — or 404. */
  private async owned(ctx: PortalCtx, id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Appointment not found');
    const appt = await this.apptModel.findById(id).lean();
    if (!appt) throw new NotFoundException('Appointment not found');
    const link = await this.scope.linkFor(
      ctx,
      appt.clinicId,
      appt.patientId,
      'book',
    );
    if (!link) throw new NotFoundException('Appointment not found');
    return { appt, link };
  }

  // --- Book ----------------------------------------------------------------

  /**
   * Book through the clinic's own booking service. The slot is re-derived
   * on the server from the clinic's availability — the client only says
   * which day and time it wants — and `AppointmentsService.create` then
   * re-validates availability and runs its transactional overlap check.
   */
  async book(
    ctx: PortalCtx,
    input: {
      patientId?: string;
      clinicId: string;
      doctorId: string;
      date: string;
      time: string;
      reason?: string;
      shareRecords?: boolean;
      payment?: 'clinic' | 'online';
    },
  ): Promise<PortalAppointmentView> {
    const subject = await this.scope.subject(ctx, input.patientId, 'book');
    const info = await this.directory.bookableBranch(input.clinicId);
    const doctor = await this.directory.bookableDoctor(info, input.doctorId);
    const { startAt, endAt } = await this.resolveSlot(
      info,
      input.doctorId,
      input.date,
      input.time,
    );

    const patientId = await this.patientAtClinic(ctx, subject, info);
    await this.assertWithinLimits(info, patientId, doctor.view.id, input.date);

    const appt = await this.appointments.create(info.clinicId, undefined, {
      type: AppointmentType.Time,
      branchId: String(info.branchId),
      doctorId: doctor.view.id,
      patientId: patientId.toHexString(),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      source: AppointmentSource.PatientPortal,
      notes: input.reason?.trim() || undefined,
      // A bill is issued only when paying online, so the patient has
      // something to pay. "Pay at clinic" leaves billing to the front desk,
      // exactly as for a phone booking.
      visitTypeId:
        input.payment === 'online' ? doctor.firstVisitTypeId : undefined,
    } as any);
    this.directory.invalidateNext(info.branchId, doctor.view.id);
    touch(ctx, info.clinicId);

    if (input.shareRecords) {
      // Sharing for this visit: until a week after the appointment.
      await this.recordAccess.set({
        accountId: subject.account._id,
        clinicId: info.clinicId,
        enabled: true,
        source: RecordAccessSource.Booking,
        expiresAt: new Date(endAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      });
    }

    const apptId = String((appt as any)._id);
    this.audit.record(ctx, {
      clinicId: info.clinicId,
      branchId: info.branchId,
      action: AuditAction.Create,
      entityType: '/portal/appointments',
      entityId: apptId,
      targetLabel: subject.account.fullName,
      subjectAccountId: subject.account._id,
    });

    const links = await this.scope.links(ctx, 'book', [subject]);
    const [view] = await this.toViews(
      ctx,
      [await this.apptModel.findById(apptId).lean()],
      links,
    );
    return view;
  }

  private async resolveSlot(
    info: BranchInfo,
    doctorId: string,
    date: string,
    time: string,
    ignoreId?: string,
  ) {
    if (parseClockTime(time) === null)
      throw new BadRequestException('time must look like "10:30 AM"');
    const { groups } = await this.directory.slots(
      info,
      doctorId,
      date,
      ignoreId,
    );
    const slot = groups.flatMap((g) => g.slots).find((s) => s.time === time);
    if (!slot)
      throw new BadRequestException(
        'That time is not available. Please pick another slot.',
      );
    if (slot.booked)
      throw new ConflictException(
        'That slot was just taken. Please pick another time.',
      );
    return { startAt: new Date(slot.startAt), endAt: new Date(slot.endAt) };
  }

  /**
   * The subject's record at this clinic. When they have none yet, the portal
   * registers them there — unless the clinic already has an unconfirmed
   * record with their number, which would become a duplicate.
   */
  private async patientAtClinic(
    ctx: PortalCtx,
    subject: Subject,
    info: BranchInfo,
  ): Promise<Types.ObjectId> {
    const existing = await this.identities.resolveLink(
      subject.account._id,
      info.clinicId,
    );
    if (existing) return existing.patientId;

    // A record may have appeared since the last login (e.g. phone booking).
    await this.identities.syncLinks(subject.account);
    const synced = await this.identities.resolveLink(
      subject.account._id,
      info.clinicId,
    );
    if (synced) return synced.patientId;

    const acc = subject.account;
    if (!acc.fullName || !acc.dob) {
      throw new BadRequestException(
        'Add a name and date of birth to the profile before booking.',
      );
    }
    const phone = acc.phone ?? ctx.account.phone;
    if (!phone)
      throw new BadRequestException('A mobile number is required to book');

    const dto = {
      fullName: acc.fullName,
      gender: acc.gender ? GENDER_TO_PATIENT[acc.gender] : PatientGender.Male,
      dob: acc.dob,
      phones: [phone],
      emails: acc.email ? [acc.email] : undefined,
      primaryBranchId: String(info.branchId),
      notes: 'Registered via the DigiRx patient portal',
    } as any;
    let res = await this.patients.create(info.clinicId, dto);
    if (res.duplicateCandidate) {
      const variants = new Set(
        phoneVariants(phone, acc.dialCode ?? ctx.account.dialCode),
      );
      const samePhone = res.existing.some((p: any) =>
        ((p.normalizedPhones ?? []) as string[]).some((n) => variants.has(n)),
      );
      if (samePhone) {
        throw new ConflictException(
          'This clinic already has a record with your mobile number that we could not match to your profile. Please contact the clinic to book.',
        );
      }
      // Only a same-name match at the clinic: a different person.
      res = await this.patients.create(info.clinicId, dto, { force: true });
    }
    const created = res.created as any;
    await this.identities.linkSelfRegistered(
      subject.account._id,
      info.clinicId,
      created._id,
    );
    this.audit.record(ctx, {
      clinicId: info.clinicId,
      branchId: info.branchId,
      action: AuditAction.Create,
      entityType: '/portal/patients',
      entityId: String(created._id),
      targetLabel: acc.fullName,
      subjectAccountId: acc._id,
    });
    return created._id;
  }

  private async assertWithinLimits(
    info: BranchInfo,
    patientId: Types.ObjectId,
    doctorId: string,
    date: string,
  ) {
    const tz = info.timezone;
    const dayStart = DateTime.fromISO(date, { zone: tz })
      .startOf('day')
      .toUTC()
      .toJSDate();
    const dayEnd = DateTime.fromISO(date, { zone: tz })
      .endOf('day')
      .toUTC()
      .toJSDate();
    const [sameDay, upcoming] = await Promise.all([
      this.apptModel.exists({
        clinicId: info.clinicId,
        patientId,
        doctorId: new Types.ObjectId(doctorId),
        status: { $in: UPCOMING },
        startAt: { $gte: dayStart, $lte: dayEnd },
      }),
      this.apptModel.countDocuments({
        clinicId: info.clinicId,
        patientId,
        status: { $in: UPCOMING },
        startAt: { $gt: new Date() },
      }),
    ]);
    if (sameDay)
      throw new ConflictException(
        'You already have an appointment with this doctor that day',
      );
    if (upcoming >= info.portal.maxActiveFutureAppointments) {
      throw new BadRequestException(
        `You can have up to ${info.portal.maxActiveFutureAppointments} upcoming appointments at this clinic`,
      );
    }
  }

  // --- Change --------------------------------------------------------------

  private async assertLeadTime(info: BranchInfo, startAt?: Date) {
    if (!startAt) return;
    const hours = info.portal.cancellationLeadTimeHours;
    if (startAt.getTime() - Date.now() < hours * 60 * 60 * 1000) {
      throw new BadRequestException(
        `Changes are possible up to ${hours} hour${hours === 1 ? '' : 's'} before the visit. Please call the clinic.`,
      );
    }
  }

  async cancel(
    ctx: PortalCtx,
    id: string,
    reason: string,
  ): Promise<PortalAppointmentView> {
    const { appt, link } = await this.owned(ctx, id);
    if (appt.status !== AppointmentStatus.Booked) {
      throw new BadRequestException(
        'Only booked appointments can be cancelled here. Please call the clinic.',
      );
    }
    const [info] = await this.directory.branches([appt.branchId]);
    if (!info) throw new NotFoundException('Appointment not found');
    await this.assertLeadTime(info, appt.startAt);

    await this.appointments.cancel(
      appt.clinicId,
      id,
      undefined,
      reason,
      AppointmentSource.PatientPortal,
    );
    if (appt.doctorId)
      this.directory.invalidateNext(appt.branchId, appt.doctorId);

    // A fee bill the portal issued for online payment, with nothing paid,
    // would otherwise linger as "due".
    if (appt.billId && appt.source === AppointmentSource.PatientPortal) {
      const paid = await this.paymentModel.exists({ billId: appt.billId });
      if (!paid) {
        await this.billing
          .voidBill(
            appt.clinicId,
            undefined,
            String(appt.billId),
            'Appointment cancelled by the patient (portal)',
          )
          .catch((e) =>
            this.logger.warn(`void on cancel failed: ${e?.message ?? e}`),
          );
      }
    }

    touch(ctx, appt.clinicId);
    this.audit.record(ctx, {
      clinicId: appt.clinicId,
      branchId: appt.branchId,
      action: AuditAction.Update,
      entityType: '/portal/appointments/:id/cancel',
      entityId: id,
      subjectAccountId: link.subject.account._id,
      meta: { reason },
    });
    const [view] = await this.toViews(
      ctx,
      [await this.apptModel.findById(id).lean()],
      [link],
    );
    return view;
  }

  async reschedule(
    ctx: PortalCtx,
    id: string,
    date: string,
    time: string,
  ): Promise<PortalAppointmentView> {
    const { appt, link } = await this.owned(ctx, id);
    if (
      appt.type !== AppointmentType.Time ||
      appt.status !== AppointmentStatus.Booked ||
      !appt.doctorId
    ) {
      throw new BadRequestException(
        'This appointment cannot be rescheduled online. Please call the clinic.',
      );
    }
    const info = await this.directory.bookableBranch(String(appt.branchId));
    await this.directory.bookableDoctor(info, String(appt.doctorId));
    await this.assertLeadTime(info, appt.startAt);
    const { startAt, endAt } = await this.resolveSlot(
      info,
      String(appt.doctorId),
      date,
      time,
      id,
    );

    await this.appointments.rescheduleWithinAvailability(
      appt.clinicId,
      id,
      startAt,
      endAt,
    );
    this.directory.invalidateNext(appt.branchId, appt.doctorId);
    touch(ctx, appt.clinicId);
    this.audit.record(ctx, {
      clinicId: appt.clinicId,
      branchId: appt.branchId,
      action: AuditAction.Update,
      entityType: '/portal/appointments/:id/reschedule',
      entityId: id,
      subjectAccountId: link.subject.account._id,
      meta: { from: appt.startAt, to: startAt },
    });
    const [view] = await this.toViews(
      ctx,
      [await this.apptModel.findById(id).lean()],
      [link],
    );
    return view;
  }
}
