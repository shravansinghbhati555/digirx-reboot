/**
 * Response shapes of the patient-portal API.
 *
 * They mirror `DigiRx-Patient/client/src/types.ts` so the portal client can
 * render them directly. Every field is built by an explicit mapper in
 * `portal.mappers.ts` — a database document is never returned as-is, so
 * staff-only fields (clinical notes, face data, tags, internal ids) cannot
 * leak by accident.
 *
 * `id` of a portal "clinic" is a clinic BRANCH id (where a visit happens and
 * what has an address); `tenantId` is the owning clinic.
 */

export type ID = string;
export type LocalDate = string; // YYYY-MM-DD in clinic-local time

export interface PortalGrants {
  book: boolean;
  rx: boolean;
  reports: boolean;
  bills: boolean;
}

export interface PortalPatientView {
  id: ID;
  name: string;
  firstName: string;
  initials: string;
  color: string;
  phone: string;
  dob: string;
  age: number;
  gender: 'Female' | 'Male' | 'Other';
  bloodGroup?: string;
  email?: string;
  patientCode: string;
  healthTags: string[];
  /** Server-side profile state; the client uses it to route to profile setup. */
  profileComplete: boolean;
  /** Profile date of birth as YYYY-MM-DD (for editing). */
  dobIso?: string;
  dobLocked: boolean;
}

export interface PortalClinicView {
  id: ID;
  tenantId: ID;
  name: string;
  short: string;
  initials: string;
  area: string;
  address: string;
  phone: string;
  distanceKm: number;
  doctorCount: number;
  hours: string;
  openUntil: string;
  feesFrom: number;
  color: string;
  gradient: string;
  services: string[];
  tags: string[];
  bookingEnabled: boolean;
  cancellationLeadTimeHours: number;
  maxAdvanceDays: number;
}

export interface PortalDoctorClinicView {
  clinicId: ID;
  schedule: string;
  days: number[];
}

export interface PortalDoctorView {
  id: ID;
  name: string;
  initials: string;
  color: string;
  speciality: string;
  specialityId: ID;
  qualifications: string;
  regNo?: string;
  years: number;
  fee: number;
  durationMin: number;
  languages: string[];
  about: string;
  clinics: PortalDoctorClinicView[];
  availabilityNote: string;
  seenBefore: boolean;
  pronoun: 'her' | 'him' | 'them';
  bookable: boolean;
}

export interface PortalSpecialityView {
  id: ID;
  label: string;
  doctorCount: number;
}

export type PortalAppointmentStatus =
  | 'confirmed'
  | 'pending'
  | 'completed'
  | 'missed'
  | 'cancelled';

export interface PortalAppointmentView {
  id: ID;
  code: string;
  patientId: ID;
  doctorId?: ID;
  clinicId: ID;
  date: LocalDate;
  time: string;
  durationMin: number;
  title: string;
  status: PortalAppointmentStatus;
  fee: number;
  payment: 'clinic' | 'online';
  reason?: string;
  cancelledBy?: 'you' | 'clinic';
  outcomeNote?: string;
  visitId?: ID;
  reportId?: ID;
  invoiceId?: ID;
  startAt?: string;
  endAt?: string;
}

export type PortalRecordType = 'visit' | 'lab' | 'rx' | 'vax';

export interface PortalRecordView {
  id: ID;
  type: PortalRecordType;
  date: LocalDate;
  clinicId: ID;
  title: string;
  who: string;
  summary: string;
  to: string;
  patientId: ID;
}

export interface PortalVisitView {
  id: ID;
  date: LocalDate;
  time: string;
  clinicId: ID;
  doctorId: ID;
  title: string;
  mode: string;
  vitals?: { label: string; value: string; unit: string }[];
  diagnosis?: string;
  notes: string;
  prescriptionId?: ID;
  reportId?: ID;
  invoiceId?: ID;
  followUp?: string;
  patientId: ID;
}

export type PortalReportCategory = 'lab' | 'imaging' | 'summary' | 'uploaded';

export interface PortalReportView {
  id: ID;
  title: string;
  shortName?: string;
  clinicId?: ID;
  date: LocalDate;
  category: PortalReportCategory;
  isNew?: boolean;
  thumb: string;
  orderedBy?: string;
  sampledAt?: string;
  reportedAt?: string;
  labId?: string;
  verifiedBy?: string;
  pages: number;
  results?: {
    test: string;
    result: string;
    range: string;
    flag?: 'LOW' | 'HIGH';
  }[];
  alert?: string;
  mimeType: string;
  patientId: ID;
}

export interface PortalMedicineView {
  name: string;
  form: string;
  duration: string;
  schedule: [number, number, number];
  instructions: string;
}

export interface PortalPrescriptionView {
  id: ID;
  title: string;
  date: LocalDate;
  validTill?: LocalDate;
  doctorId: ID;
  clinicId: ID;
  patientId: ID;
  active: boolean;
  dayOf?: [number, number];
  medicines: PortalMedicineView[];
  advice: string[];
  thumb: string;
  prescriptionNo?: string;
}

export type PortalInvoiceStatus = 'due' | 'paid' | 'refunded';

export interface PortalInvoiceView {
  id: ID;
  title: string;
  clinicId: ID;
  doctorId?: ID;
  patientId: ID;
  date: LocalDate;
  dueDate?: LocalDate;
  amount: number;
  outstanding: number;
  currency: string;
  status: PortalInvoiceStatus;
  method?: 'UPI' | 'Card' | 'Cash';
  paidOn?: LocalDate;
  reference?: string;
  gstin?: string;
  billNo?: string;
  items: { label: string; amount: number; muted?: boolean }[];
}

export type PortalFamilyKind = 'dependant' | 'linked' | 'pending';

export interface PortalFamilyMemberView {
  id: ID;
  /** Connection id for linked/pending members (used by grant/remove/respond calls). */
  connectionId?: ID;
  /** True for an invite someone sent to this account, awaiting an answer. */
  incoming?: boolean;
  name: string;
  firstName: string;
  initials: string;
  color: string;
  relation: string;
  kind: PortalFamilyKind;
  /**
   * On someone else's tree (the person who connected you), not a direct
   * link of this account. Shown in the tree; they control their own access.
   */
  shared?: boolean;
  note: string;
  age?: number;
  linkedSince?: string;
  theyAllow: PortalGrants;
  youAllow: PortalGrants;
  grantsChangedOn?: string;
}

export type PortalNotificationKind =
  | 'appointment'
  | 'records'
  | 'family'
  | 'medicine'
  | 'payment';

export interface PortalNotificationView {
  id: ID;
  kind: PortalNotificationKind;
  title: string;
  body: string;
  when: string;
  group: 'Today' | 'Earlier';
  unread: boolean;
  to: string;
}

export interface PortalPrivacyView {
  clinicSharing: Record<ID, boolean>;
  appLock: boolean;
  hidePreviews: boolean;
}

export interface PortalDataView {
  patient: PortalPatientView;
  clinics: PortalClinicView[];
  doctors: PortalDoctorView[];
  specialities: PortalSpecialityView[];
  appointments: PortalAppointmentView[];
  records: PortalRecordView[];
  visits: PortalVisitView[];
  reports: PortalReportView[];
  prescriptions: PortalPrescriptionView[];
  invoices: PortalInvoiceView[];
  family: PortalFamilyMemberView[];
  notifications: PortalNotificationView[];
  privacy: PortalPrivacyView;
  /** Clinic-local "today" for the account's main clinic, YYYY-MM-DD. */
  today: LocalDate;
}

export interface PortalSlotView {
  time: string;
  booked: boolean;
  startAt: string;
  endAt: string;
}

export interface PortalSlotGroupView {
  name: 'Morning' | 'Evening';
  slots: PortalSlotView[];
}
