import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import { Clinic, ClinicStatus } from '../../tenancy/schemas/clinic.schema';
import { Branch, legacyAddressLine } from '../../tenancy/schemas/branch.schema';
import {
  mergeClinicSettings,
  type PortalSettings,
} from '../../tenancy/clinic-settings.types';
import { DoctorProfile } from '../../appointments/schemas/doctor-profile.schema';
import { DoctorAvailabilityRule } from '../../availability/schemas/doctor-availability-rule.schema';
import { VisitType } from '../../visit-types/schemas/visit-type.schema';
import { AppointmentsService } from '../../appointments/appointments.service';
import { UsersService } from '../../authz/users.service';
import type {
  PortalClinicView,
  PortalDoctorView,
  PortalSlotGroupView,
  PortalSpecialityView,
} from '../views/portal-view.types';
import {
  colorFor,
  gradientFor,
  hhmmToLabel,
  initialsOf,
  toSlotGroups,
} from '../views/portal.mappers';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const NEXT_HORIZON_DAYS = 14;
const NEXT_CACHE_MS = 60_000;

/** A clinic branch as the portal sees it, with the clinic's portal rules. */
export type BranchInfo = {
  branchId: Types.ObjectId;
  clinicId: Types.ObjectId;
  clinicName: string;
  timezone: string;
  currency: string;
  portal: PortalSettings;
  /** Clinic is approved and has the portal on. */
  visible: boolean;
  branch: any;
  branchCount: number;
};

type DoctorInfo = {
  view: PortalDoctorView;
  clinicId: Types.ObjectId;
  /** branchId → slot length + bookability */
  branchIds: string[];
  minFee: number;
  firstVisitTypeId?: string;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'general'
  );
}

/** [1,2,3,4,5,6] → "Mon–Sat"; [1,3,5] → "Mon, Wed, Fri". */
export function daysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const runs: number[][] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && d === last[last.length - 1] + 1) last.push(d);
    else runs.push([d]);
  }
  return runs
    .map((r) =>
      r.length >= 3
        ? `${DOW[r[0]]}–${DOW[r[r.length - 1]]}`
        : r.map((d) => DOW[d]).join(', '),
    )
    .join(', ');
}

function minutesLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return hhmmToLabel(
    `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
  );
}

function windowsLabel(
  windows: { startMinutes: number; endMinutes: number }[],
): string {
  return windows
    .map(
      (w) => `${minutesLabel(w.startMinutes)} – ${minutesLabel(w.endMinutes)}`,
    )
    .join(', ');
}

/**
 * Clinic + doctor discovery and slot lookup for the portal. Availability
 * always comes from the clinic's own AvailabilityService/AppointmentsService
 * — the portal has no scheduling logic of its own.
 */
@Injectable()
export class PortalDirectoryService {
  private nextCache = new Map<
    string,
    { at: number; value: { date: string; times: string[] } | null }
  >();

  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(DoctorProfile.name)
    private readonly profileModel: Model<DoctorProfile>,
    @InjectModel(DoctorAvailabilityRule.name)
    private readonly ruleModel: Model<DoctorAvailabilityRule>,
    @InjectModel(VisitType.name)
    private readonly visitTypeModel: Model<VisitType>,
    private readonly appointments: AppointmentsService,
    private readonly users: UsersService,
  ) {}

  // --- Branches / clinics --------------------------------------------------

  private toInfo(clinic: any, branch: any, branchCount: number): BranchInfo {
    const portal = mergeClinicSettings(clinic.settings).portal;
    const active =
      (clinic.status ?? ClinicStatus.Active) === ClinicStatus.Active;
    return {
      branchId: branch._id,
      clinicId: clinic._id,
      clinicName:
        mergeClinicSettings(clinic.settings).branding.displayName ||
        clinic.name,
      timezone: clinic.timezone || 'UTC',
      currency: clinic.currency || 'INR',
      portal,
      visible: active && portal.enabled && branch.active !== false,
      branch,
      branchCount,
    };
  }

  /** Branches by id, with their clinic. Unknown ids are dropped. */
  async branches(branchIds: Types.ObjectId[]): Promise<BranchInfo[]> {
    if (!branchIds.length) return [];
    const branches = await this.branchModel
      .find({ _id: { $in: branchIds } })
      .lean();
    return this.withClinics(branches);
  }

  /** Every branch of the given clinics. */
  async branchesOfClinics(clinicIds: Types.ObjectId[]): Promise<BranchInfo[]> {
    if (!clinicIds.length) return [];
    const branches = await this.branchModel
      .find({ clinicId: { $in: clinicIds }, active: { $ne: false } })
      .lean();
    return this.withClinics(branches);
  }

  private async withClinics(branches: any[]): Promise<BranchInfo[]> {
    const clinicIds = [...new Set(branches.map((b) => String(b.clinicId)))].map(
      (s) => new Types.ObjectId(s),
    );
    const [clinics, counts] = await Promise.all([
      this.clinicModel.find({ _id: { $in: clinicIds } }).lean(),
      this.branchModel.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { clinicId: { $in: clinicIds }, active: { $ne: false } } },
        { $group: { _id: '$clinicId', n: { $sum: 1 } } },
      ]),
    ]);
    const byId = new Map(clinics.map((c) => [String(c._id), c]));
    const countBy = new Map(counts.map((c) => [String(c._id), c.n]));
    return branches
      .filter((b) => byId.has(String(b.clinicId)))
      .map((b) =>
        this.toInfo(
          byId.get(String(b.clinicId)),
          b,
          countBy.get(String(b.clinicId)) ?? 1,
        ),
      );
  }

  /** One branch the patient may book at, or 404. */
  async bookableBranch(branchId: string): Promise<BranchInfo> {
    if (!Types.ObjectId.isValid(branchId))
      throw new NotFoundException('Clinic not found');
    const [info] = await this.branches([new Types.ObjectId(branchId)]);
    if (!info || !info.visible) throw new NotFoundException('Clinic not found');
    if (!info.portal.bookingEnabled) {
      throw new BadRequestException(
        'This clinic does not take online bookings yet. Please call the clinic.',
      );
    }
    return info;
  }

  /** Clinics discoverable in the portal: approved and opted in. */
  async discover(q?: string, limit = 30): Promise<BranchInfo[]> {
    const filter: Record<string, unknown> = {
      'settings.portal.enabled': true,
      $or: [{ status: ClinicStatus.Active }, { status: null }],
    };
    const text = (q ?? '').trim().slice(0, 80);
    const clinics = await this.clinicModel
      .find(
        text
          ? { ...filter, name: { $regex: escapeRegex(text), $options: 'i' } }
          : filter,
      )
      .limit(Math.min(50, limit))
      .lean();
    const infos = await this.branchesOfClinics(clinics.map((c) => c._id));
    return infos.filter((i) => i.visible);
  }

  // --- Doctors -------------------------------------------------------------

  /** Doctors of the given branches, with schedules, fees and bookability. */
  async doctorsFor(branches: BranchInfo[]): Promise<DoctorInfo[]> {
    const byClinic = new Map<string, BranchInfo[]>();
    for (const b of branches)
      byClinic.set(String(b.clinicId), [
        ...(byClinic.get(String(b.clinicId)) ?? []),
        b,
      ]);

    const out: DoctorInfo[] = [];
    for (const [cid, infos] of byClinic) {
      const clinicId = new Types.ObjectId(cid);
      const branchSet = new Set(infos.map((i) => String(i.branchId)));
      const portal = infos[0].portal;
      const doctors = await this.users.listDoctors(clinicId);
      if (!doctors.length) continue;
      const ids = doctors.map(
        (d) => new Types.ObjectId(String((d as any)._id)),
      );
      const [profiles, rules, visitTypes] = await Promise.all([
        this.profileModel.find({ clinicId, userId: { $in: ids } }).lean(),
        this.ruleModel
          .find({ clinicId, doctorUserId: { $in: ids }, active: true })
          .lean(),
        this.visitTypeModel
          .find({ clinicId, doctorUserId: { $in: ids }, active: true })
          .sort({ price: 1 })
          .lean(),
      ]);
      const profileBy = new Map(profiles.map((p) => [String(p.userId), p]));

      for (const d of doctors as any[]) {
        const did = String(d._id);
        const myRules = rules.filter(
          (r) =>
            String(r.doctorUserId) === did && branchSet.has(String(r.branchId)),
        );
        const myTypes = visitTypes.filter(
          (v) => String(v.doctorUserId) === did,
        );
        const profile = profileBy.get(did);
        const ruleBranches = [
          ...new Set(myRules.map((r) => String(r.branchId))),
        ];
        const branchIds = ruleBranches.length
          ? ruleBranches
          : (d.branchIds ?? [])
              .map(String)
              .filter((b: string) => branchSet.has(b));
        if (!branchIds.length) continue;

        const allowList = portal.bookableDoctorIds;
        const bookable =
          portal.bookingEnabled &&
          myRules.length > 0 &&
          (allowList.length === 0 || allowList.includes(did));
        const clinics = branchIds.map((bid: string) => {
          const br = myRules.filter(
            (r) => String(r.branchId) === bid && (r.windows ?? []).length,
          );
          const days = br.map((r) => r.weekday);
          const sample = br[0];
          const sched = [
            daysLabel(days),
            sample ? windowsLabel(sample.windows) : '',
          ]
            .filter(Boolean)
            .join(' · ');
          return { clinicId: bid, schedule: sched, days };
        });
        const allDays = clinics.flatMap((c: { days: number[] }) => c.days);
        const speciality = profile?.specialties?.[0] || 'General physician';
        const fee = myTypes[0]?.price ?? 0;
        const name: string = d.name;
        out.push({
          clinicId,
          branchIds,
          minFee: fee,
          firstVisitTypeId: myTypes[0] ? String(myTypes[0]._id) : undefined,
          view: {
            id: did,
            name,
            initials: initialsOf(name),
            color: colorFor(did),
            speciality,
            specialityId: slug(speciality),
            qualifications: d.qualifications ?? '',
            regNo: d.registrationNumber,
            years: 0,
            fee,
            durationMin:
              myRules[0]?.slotMinutes || profile?.defaultSlotMinutes || 15,
            languages: [],
            about: '',
            clinics,
            availabilityNote: daysLabel(allDays),
            seenBefore: false,
            pronoun: 'them',
            bookable,
          },
        });
      }
    }
    return out;
  }

  /** A doctor the patient may book at this branch, or 404. */
  async bookableDoctor(
    info: BranchInfo,
    doctorId: string,
  ): Promise<DoctorInfo> {
    if (!Types.ObjectId.isValid(doctorId))
      throw new NotFoundException('Doctor not found');
    const [doc] = (await this.doctorsFor([info])).filter(
      (d) => d.view.id === doctorId,
    );
    if (
      !doc ||
      !doc.view.bookable ||
      !doc.branchIds.includes(String(info.branchId))
    ) {
      throw new NotFoundException('Doctor not found');
    }
    return doc;
  }

  clinicView(
    info: BranchInfo,
    doctors: DoctorInfo[],
    visited: boolean,
  ): PortalClinicView {
    const b = info.branch;
    const id = String(info.branchId);
    const here = doctors.filter((d) => d.branchIds.includes(id));
    const fees = here.map((d) => d.minFee).filter((f) => f > 0);
    const name =
      info.branchCount > 1 ? `${info.clinicName} – ${b.name}` : info.clinicName;
    const address = b.addressLine || legacyAddressLine(b.address) || '';
    const area =
      info.branchCount > 1
        ? b.name
        : String((b.address as any)?.city ?? '') || b.name || '';
    const open = hhmmToLabel(b.workingHours?.open);
    const close = hhmmToLabel(b.workingHours?.close);
    return {
      id,
      tenantId: String(info.clinicId),
      name,
      short: info.clinicName.split(/\s+/)[0] ?? info.clinicName,
      initials: initialsOf(info.clinicName),
      area,
      address,
      phone: b.phone ?? '',
      distanceKm: -1,
      doctorCount: here.length,
      hours: open && close ? `${open} – ${close}` : '',
      openUntil: close,
      feesFrom: fees.length ? Math.min(...fees) : 0,
      color: colorFor(String(info.clinicId)),
      gradient: gradientFor(String(info.clinicId)),
      services: [],
      tags: visited ? ["You've visited"] : [],
      bookingEnabled: info.visible && info.portal.bookingEnabled,
      cancellationLeadTimeHours: info.portal.cancellationLeadTimeHours,
      maxAdvanceDays: info.portal.maxAdvanceDays,
    };
  }

  specialities(doctors: PortalDoctorView[]): PortalSpecialityView[] {
    const m = new Map<string, PortalSpecialityView>();
    for (const d of doctors) {
      const s = m.get(d.specialityId) ?? {
        id: d.specialityId,
        label: d.speciality,
        doctorCount: 0,
      };
      s.doctorCount += 1;
      m.set(d.specialityId, s);
    }
    return [...m.values()].sort((a, b) => b.doctorCount - a.doctorCount);
  }

  // --- Slots ---------------------------------------------------------------

  todayIn(tz: string): string {
    return DateTime.now().setZone(tz).toISODate()!;
  }

  assertBookableDate(info: BranchInfo, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new BadRequestException('date must be YYYY-MM-DD');
    const today = this.todayIn(info.timezone);
    if (date < today)
      throw new BadRequestException('Pick a date from today onwards');
    const last = DateTime.fromISO(today)
      .plus({ days: info.portal.maxAdvanceDays })
      .toISODate()!;
    if (date > last) {
      throw new BadRequestException(
        `This clinic takes bookings up to ${info.portal.maxAdvanceDays} days ahead`,
      );
    }
  }

  /** Slot groups for one day. Never reveals who holds a booked slot. */
  async slots(
    info: BranchInfo,
    doctorId: string,
    date: string,
    ignoreAppointmentId?: string,
  ) {
    this.assertBookableDate(info, date);
    const day = await this.appointments.availableSlots({
      clinicId: info.clinicId,
      branchId: String(info.branchId),
      doctorId,
      date,
    });
    const slots = day.slots.map((s: any) =>
      // The appointment being rescheduled shouldn't block its own slot.
      s.status === 'booked' &&
      ignoreAppointmentId &&
      s.bookedBy?.apptId === ignoreAppointmentId
        ? { startAt: s.startAt, endAt: s.endAt, status: 'available' }
        : { startAt: s.startAt, endAt: s.endAt, status: s.status },
    );
    return {
      raw: slots,
      groups: toSlotGroups(slots, info.timezone) as PortalSlotGroupView[],
    };
  }

  /** First day (within two weeks) with an open slot, cached for a minute. */
  async nextAvailable(
    info: BranchInfo,
    doctorId: string,
  ): Promise<{ date: string; times: string[] } | null> {
    const today = this.todayIn(info.timezone);
    const key = `${info.branchId}|${doctorId}|${today}`;
    const hit = this.nextCache.get(key);
    if (hit && Date.now() - hit.at < NEXT_CACHE_MS) return hit.value;

    let value: { date: string; times: string[] } | null = null;
    const horizon = Math.min(NEXT_HORIZON_DAYS, info.portal.maxAdvanceDays + 1);
    for (let i = 0; i < horizon && !value; i++) {
      const date = DateTime.fromISO(today).plus({ days: i }).toISODate()!;
      const { groups } = await this.slots(info, doctorId, date);
      const times = groups.flatMap((g) =>
        g.slots.filter((s) => !s.booked).map((s) => s.time),
      );
      if (times.length) value = { date, times };
    }
    if (this.nextCache.size > 5000) this.nextCache.clear();
    this.nextCache.set(key, { at: Date.now(), value });
    return value;
  }

  invalidateNext(branchId: Types.ObjectId, doctorId: Types.ObjectId | string) {
    const prefix = `${branchId}|${doctorId}|`;
    for (const k of this.nextCache.keys())
      if (k.startsWith(prefix)) this.nextCache.delete(k);
  }
}
