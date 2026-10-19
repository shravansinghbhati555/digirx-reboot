import { DateTime } from 'luxon';
import type {
  PortalAppointmentStatus,
  PortalAppointmentView,
  PortalInvoiceView,
  PortalMedicineView,
  PortalPatientView,
  PortalPrescriptionView,
  PortalReportCategory,
  PortalSlotGroupView,
} from './portal-view.types';
import {
  AppointmentSource,
  AppointmentStatus,
  AppointmentType,
} from '../../appointments/schemas/appointment.schema';
import { BillStatus } from '../../billing/schemas/bill.schema';
import { PaymentMethod } from '../../billing/schemas/payment.schema';
import { DocumentCategory } from '../../documents/schemas/document.schema';
import { PatientAccountGender } from '../../patient-identities/schemas/patient-account.schema';
import { ageOn } from '../../patient-identities/identity.utils';

// ---------------------------------------------------------------------------
// Small formatting helpers
// ---------------------------------------------------------------------------

const PALETTE = [
  '#FFB690',
  '#9CC9FF',
  '#C9B2FF',
  '#FFA7DC',
  '#FFC27A',
  '#A8E0C2',
];
const GRADIENTS = ['bg-clinic-a', 'bg-clinic-b', 'bg-clinic-c'];
const THUMBS = ['#FFE0F2', '#FFE6D8', '#ECE3FF', '#DCEBFF', '#FFF1D6'];

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable identity colour for an id. */
export const colorFor = (id: string) => PALETTE[hashOf(id) % PALETTE.length];
export const gradientFor = (id: string) =>
  GRADIENTS[hashOf(id) % GRADIENTS.length];
export const thumbFor = (id: string) => THUMBS[hashOf(id) % THUMBS.length];

export function initialsOf(name: string): string {
  return (
    name
      .replace(/^dr\.?\s+/i, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export const firstNameOf = (name: string) =>
  name
    .replace(/^dr\.?\s+/i, '')
    .trim()
    .split(/\s+/)[0] ?? '';

/** Clinic-local calendar date of an instant. */
export function localDate(
  d: Date | string | undefined | null,
  tz: string,
): string {
  if (!d) return '';
  return (
    DateTime.fromJSDate(new Date(d), { zone: 'utc' }).setZone(tz).toISODate() ??
    ''
  );
}

/** Clinic-local "10:30 AM". */
export function localTime(
  d: Date | string | undefined | null,
  tz: string,
): string {
  if (!d) return '';
  return DateTime.fromJSDate(new Date(d), { zone: 'utc' })
    .setZone(tz)
    .toFormat('h:mm a');
}

/** "10:30 AM" → minutes after midnight, or null. */
export function parseClockTime(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 1 || h > 12 || mm > 59) return null;
  return ((h % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + mm;
}

/** "09:00" → "9 AM", "20:30" → "8:30 PM". */
export function hhmmToLabel(hhmm?: string): string {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const dt = DateTime.fromObject({ hour: h, minute: m });
  return m === 0 ? dt.toFormat('h a') : dt.toFormat('h:mm a');
}

/** "+91 98450 12345" */
export function displayPhone(
  phone: string | undefined,
  dialCode = '91',
): string {
  if (!phone) return '';
  const p =
    phone.length === 10 ? `${phone.slice(0, 5)} ${phone.slice(5)}` : phone;
  return `+${dialCode} ${p}`;
}

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

const GENDER: Record<PatientAccountGender, PortalPatientView['gender']> = {
  [PatientAccountGender.Female]: 'Female',
  [PatientAccountGender.Male]: 'Male',
  [PatientAccountGender.Other]: 'Other',
};

export function toPatientView(
  account: {
    _id: { toHexString(): string };
    fullName?: string;
    phone?: string;
    dialCode?: string;
    dob?: string;
    gender?: PatientAccountGender;
    email?: string;
    bloodGroup?: string;
    profileCompletedAt?: Date;
  },
  opts: { dobLocked: boolean; phone?: string },
): PortalPatientView {
  const id = account._id.toHexString();
  const name = account.fullName?.trim() || 'DigiRx patient';
  const dob = account.dob;
  const code = id.slice(-10).toUpperCase();
  return {
    id,
    name,
    firstName: firstNameOf(name),
    initials: initialsOf(name),
    color: colorFor(id),
    phone: displayPhone(opts.phone ?? account.phone, account.dialCode),
    dob: dob
      ? `${dob.slice(8, 10)} / ${dob.slice(5, 7)} / ${dob.slice(0, 4)}`
      : '',
    dobIso: dob,
    age: dob ? (ageOn(dob) ?? 0) : 0,
    gender: account.gender ? GENDER[account.gender] : 'Other',
    bloodGroup: account.bloodGroup,
    email: account.email,
    patientCode: `DRX-${code.slice(0, 2)}-${code.slice(2, 6)}-${code.slice(6, 10)}`,
    healthTags: account.bloodGroup ? [`Blood ${account.bloodGroup}`] : [],
    profileComplete: !!account.profileCompletedAt,
    dobLocked: opts.dobLocked,
  };
}

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

export function appointmentStatus(
  appt: {
    status: AppointmentStatus;
    startAt?: Date;
    type: AppointmentType;
    queueDate?: string;
  },
  today: string,
  tz: string,
  now: Date = new Date(),
): PortalAppointmentStatus {
  switch (appt.status) {
    case AppointmentStatus.Done:
      return 'completed';
    case AppointmentStatus.NoShow:
      return 'missed';
    case AppointmentStatus.Cancelled:
      return 'cancelled';
    case AppointmentStatus.CheckedIn:
    case AppointmentStatus.InProgress:
      return 'confirmed';
    default: {
      // Booked, but the day has passed without a check-in.
      const day =
        appt.type === AppointmentType.Queue
          ? appt.queueDate
          : localDate(appt.startAt, tz);
      if (day && day < today) return 'missed';
      if (
        appt.type === AppointmentType.Time &&
        appt.startAt &&
        appt.startAt < now &&
        day !== today
      )
        return 'missed';
      return 'confirmed';
    }
  }
}

export function toAppointmentView(input: {
  appt: any;
  subjectId: string;
  branchId: string;
  tz: string;
  today: string;
  shortName: string;
  fee: number;
  title?: string;
  paidOnline: boolean;
  visitId?: string;
  invoiceId?: string;
}): PortalAppointmentView {
  const a = input.appt;
  const id = String(a._id);
  const isQueue = a.type === AppointmentType.Queue;
  const viaPortal = a.source === AppointmentSource.PatientPortal;
  const status = appointmentStatus(a, input.today, input.tz);
  const durationMin =
    a.startAt && a.endAt
      ? Math.max(
          5,
          Math.round(
            (new Date(a.endAt).getTime() - new Date(a.startAt).getTime()) /
              60000,
          ),
        )
      : 15;
  const cancelledByPatient = a.cancelledVia === AppointmentSource.PatientPortal;
  return {
    id,
    code: `${input.shortName.toUpperCase().slice(0, 4)}-${isQueue && a.queueNumber ? `T${a.queueNumber}` : id.slice(-5).toUpperCase()}`,
    patientId: input.subjectId,
    doctorId: a.doctorId ? String(a.doctorId) : undefined,
    clinicId: input.branchId,
    date: isQueue ? (a.queueDate ?? '') : localDate(a.startAt, input.tz),
    time: isQueue
      ? `Token ${a.queueNumber ?? ''}`.trim()
      : localTime(a.startAt, input.tz),
    durationMin,
    title: input.title ?? 'Consultation',
    status,
    fee: input.fee,
    payment: input.paidOnline ? 'online' : 'clinic',
    // Staff notes can be internal; only show what the patient wrote.
    reason: viaPortal && a.notes ? String(a.notes) : undefined,
    cancelledBy:
      status === 'cancelled'
        ? cancelledByPatient
          ? 'you'
          : 'clinic'
        : undefined,
    outcomeNote:
      status === 'cancelled'
        ? cancelledByPatient && a.cancellationReason
          ? `Reason: ${String(a.cancellationReason).toLowerCase()}`
          : 'Cancelled by the clinic'
        : undefined,
    visitId: input.visitId,
    invoiceId: input.invoiceId,
    startAt: a.startAt ? new Date(a.startAt).toISOString() : undefined,
    endAt: a.endAt ? new Date(a.endAt).toISOString() : undefined,
  };
}

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

/** "1-0-1", "OD", "BD", "TDS", "HS" → doses morning/afternoon/night. */
export function scheduleFromFrequency(freq?: string): [number, number, number] {
  const f = String(freq ?? '')
    .trim()
    .toUpperCase();
  const m =
    /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(f);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  if (/^(OD|QD|ONCE)/.test(f)) return [1, 0, 0];
  if (/^(BD|BID|TWICE)/.test(f)) return [1, 0, 1];
  if (/^(TDS|TID|THRICE)/.test(f)) return [1, 1, 1];
  if (/^(QID|QDS)/.test(f)) return [1, 1, 1];
  if (/^(HS|NIGHT|BEDTIME)/.test(f)) return [0, 0, 1];
  return [0, 0, 0];
}

/** "5 days" / "2 weeks" / "3 months" → days, or null. */
export function durationDays(duration?: string): number | null {
  const m = /(\d+)\s*(days?|d|weeks?|wks?|w|months?|mos?|m)\b/i.exec(
    String(duration ?? ''),
  );
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit.startsWith('w')) return n * 7;
  if (unit.startsWith('mo') || unit === 'm') return n * 30;
  return n;
}

export function toPrescriptionView(input: {
  rx: any;
  subjectId: string;
  branchId: string;
  tz: string;
  today: string;
  title: string;
  medicineName: (item: any) => string;
  advice: string[];
}): PortalPrescriptionView {
  const rx = input.rx;
  const id = String(rx._id);
  const date = localDate(rx.createdAt, input.tz);
  const items: any[] = rx.items ?? [];
  const longest = items.reduce(
    (max, i) => Math.max(max, durationDays(i.duration) ?? 0),
    0,
  );
  const validTill =
    longest > 0 && date
      ? (DateTime.fromISO(date)
          .plus({ days: longest - 1 })
          .toISODate() ?? undefined)
      : undefined;
  const active = !!validTill && input.today >= date && input.today <= validTill;
  const dayOf: [number, number] | undefined =
    active && date
      ? [
          Math.floor(
            DateTime.fromISO(input.today).diff(DateTime.fromISO(date), 'days')
              .days,
          ) + 1,
          longest,
        ]
      : undefined;
  const medicines: PortalMedicineView[] = items.map((i) => ({
    name: input.medicineName(i),
    form: [i.dosage].filter(Boolean).join(' · '),
    duration: i.duration ?? '',
    schedule: scheduleFromFrequency(i.frequency),
    instructions: [
      i.frequency && !/^\d/.test(i.frequency) ? i.frequency : '',
      i.instructions ?? '',
    ]
      .filter(Boolean)
      .join(' · '),
  }));
  return {
    id,
    title: input.title,
    date,
    validTill,
    doctorId: String(rx.doctorId),
    clinicId: input.branchId,
    patientId: input.subjectId,
    active,
    dayOf,
    medicines,
    advice: input.advice,
    thumb: thumbFor(id),
    prescriptionNo: rx.prescriptionNo,
  };
}

// ---------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------

const METHOD: Partial<Record<PaymentMethod, PortalInvoiceView['method']>> = {
  [PaymentMethod.Upi]: 'UPI',
  [PaymentMethod.Online]: 'UPI',
  [PaymentMethod.Card]: 'Card',
  [PaymentMethod.Cash]: 'Cash',
};

/** Draft bills are work in progress and void bills with no money taken never happened. */
export function isBillVisible(
  bill: { status: BillStatus },
  totalPaid: number,
): boolean {
  if (bill.status === BillStatus.Draft) return false;
  if (bill.status === BillStatus.Void) return totalPaid > 0;
  return true;
}

export function toInvoiceView(input: {
  bill: any;
  payments: any[];
  subjectId: string;
  branchId: string;
  doctorId?: string;
  tz: string;
  itemName: (item: any) => string;
}): PortalInvoiceView {
  const b = input.bill;
  const id = String(b._id);
  const totalPaid = input.payments.reduce(
    (s, p) => s + (Number(p.amount) || 0),
    0,
  );
  const last = [...input.payments].sort(
    (x, y) => new Date(y.paidAt).getTime() - new Date(x.paidAt).getTime(),
  )[0];
  const status: PortalInvoiceView['status'] =
    b.status === BillStatus.Void
      ? 'refunded'
      : b.status === BillStatus.Paid
        ? 'paid'
        : 'due';
  const items: PortalInvoiceView['items'] = (b.items ?? []).map((i: any) => ({
    label: `${input.itemName(i)}${i.quantity && i.quantity > 1 ? ` × ${i.quantity}` : ''}`,
    amount: Number(i.amount) || 0,
  }));
  if (b.discount)
    items.push({ label: 'Discount', amount: -Number(b.discount), muted: true });
  if (b.tax) items.push({ label: 'Tax', amount: Number(b.tax), muted: true });
  return {
    id,
    title: items[0]?.label ?? 'Clinic bill',
    clinicId: input.branchId,
    doctorId: input.doctorId,
    patientId: input.subjectId,
    date: localDate(b.issuedAt ?? b.createdAt, input.tz),
    amount: Number(b.total) || 0,
    outstanding:
      status === 'due' ? Math.max(0, (Number(b.total) || 0) - totalPaid) : 0,
    currency: b.currency ?? 'INR',
    status,
    method: last ? METHOD[last.method as PaymentMethod] : undefined,
    paidOn: b.paidAt ? localDate(b.paidAt, input.tz) : undefined,
    reference: last?.providerRef ? `Ref. ${last.providerRef}` : undefined,
    billNo: b.billNo,
    items,
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function reportCategory(c?: DocumentCategory): PortalReportCategory {
  if (c === DocumentCategory.LabReport) return 'lab';
  if (c === DocumentCategory.Imaging) return 'imaging';
  return 'uploaded';
}

export function titleFromFileName(name: string): string {
  const base = String(name ?? 'Document')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'Document';
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

/**
 * Availability → the client's slot groups. Who holds a booked slot is
 * never included: patients only learn that it is taken.
 */
export function toSlotGroups(
  slots: Array<{ startAt: string; endAt: string; status: string }>,
  tz: string,
): PortalSlotGroupView[] {
  const morning: PortalSlotGroupView = { name: 'Morning', slots: [] };
  const evening: PortalSlotGroupView = { name: 'Evening', slots: [] };
  for (const s of slots) {
    const start = DateTime.fromISO(s.startAt, { zone: 'utc' }).setZone(tz);
    const view = {
      time: start.toFormat('h:mm a'),
      booked: s.status !== 'available',
      startAt: s.startAt,
      endAt: s.endAt,
    };
    (start.hour < 12 ? morning : evening).slots.push(view);
  }
  return [morning, evening].filter((g) => g.slots.length > 0);
}
