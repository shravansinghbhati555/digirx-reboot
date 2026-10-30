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

type NextAvailableValue = {
  date: string;
  times: string[];
} | null;

export type BranchInfo = {
  branchId: Types.ObjectId;
  clinicId: Types.ObjectId;
  clinicName: string;
  timezone: string;
  currency: string;
  portal: PortalSettings;
  visible: boolean;
  branch: any;
  branchCount: number;
};

type DoctorInfo = {
  view: PortalDoctorView;
  clinicId: Types.ObjectId;
  branchIds: string[];
  minFee: number;
  firstVisitTypeId?: string;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'general'
  );
}

export function daysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);

  if (!sorted.length) return '';

  const runs: number[][] = [];

  for (const day of sorted) {
    const last = runs[runs.length - 1];

    if (last && day === last[last.length - 1] + 1) {
      last.push(day);
    } else {
      runs.push([day]);
    }
  }

  return runs
    .map((run) =>
      run.length >= 3
        ? `${DOW[run[0]]}–${DOW[run[run.length - 1]]}`
        : run.map((day) => DOW[day]).join(', '),
    )
    .join(', ');
}

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return hhmmToLabel(
    `${String(hours).padStart(2, '0')}:${String(remainingMinutes).padStart(2, '0')}`,
  );
}

function windowsLabel(
  windows: { startMinutes: number; endMinutes: number }[],
): string {
  return windows
    .map(
      (window) =>
        `${minutesLabel(window.startMinutes)} – ${minutesLabel(window.endMinutes)}`,
    )
    .join(', ');
}

@Injectable()
export class PortalDirectoryService {
  private readonly nextCache = new Map<
    string,
    { at: number; value: NextAvailableValue }
  >();

  constructor(
    @InjectModel(Clinic.name)
    private readonly clinicModel: Model<Clinic>,

    @InjectModel(Branch.name)
    private readonly branchModel: Model<Branch>,

    @InjectModel(DoctorProfile.name)
    private readonly profileModel: Model<DoctorProfile>,

    @InjectModel(DoctorAvailabilityRule.name)
    private readonly ruleModel: Model<DoctorAvailabilityRule>,

    @InjectModel(VisitType.name)
    private readonly visitTypeModel: Model<VisitType>,

    private readonly appointments: AppointmentsService,
    private readonly users: UsersService,
  ) {}

  private toInfo(clinic: any, branch: any, branchCount: number): BranchInfo {
    const settings = mergeClinicSettings(clinic.settings);

    const active =
      (clinic.status ?? ClinicStatus.Active) === ClinicStatus.Active;

    return {
      branchId: branch._id,
      clinicId: clinic._id,
      clinicName: settings.branding.displayName || clinic.name,
      timezone: clinic.timezone || 'UTC',
      currency: clinic.currency || 'INR',
      portal: settings.portal,

      // Discovery visibility and online booking are separate settings.
      visible: active && branch.active !== false,

      branch,
      branchCount,
    };
  }

  async branches(branchIds: Types.ObjectId[]): Promise<BranchInfo[]> {
    if (!branchIds.length) return [];

    const branches = await this.branchModel
      .find({ _id: { $in: branchIds } })
      .lean();

    return this.withClinics(branches);
  }

  async branchesOfClinics(clinicIds: Types.ObjectId[]): Promise<BranchInfo[]> {
    if (!clinicIds.length) return [];

    const branches = await this.branchModel
      .find({
        clinicId: { $in: clinicIds },
        active: { $ne: false },
      })
      .lean();

    return this.withClinics(branches);
  }

  private async withClinics(branches: any[]): Promise<BranchInfo[]> {
    if (!branches.length) return [];

    const clinicIds = [
      ...new Set(branches.map((branch) => String(branch.clinicId))),
    ].map((id) => new Types.ObjectId(id));

    const [clinics, counts] = await Promise.all([
      this.clinicModel
        .find({
          _id: { $in: clinicIds },
          $and: [
            {
              $or: [{ status: ClinicStatus.Active }, { status: null }],
            },
            {
              $or: [{ isPlatformClinic: false }, { isPlatformClinic: null }],
            },
          ],
        })
        .lean(),

      this.branchModel.aggregate<{
        _id: Types.ObjectId;
        n: number;
      }>([
        {
          $match: {
            clinicId: { $in: clinicIds },
            active: { $ne: false },
          },
        },
        {
          $group: {
            _id: '$clinicId',
            n: { $sum: 1 },
          },
        },
      ]),
    ]);

    const clinicById = new Map(
      clinics.map((clinic) => [String(clinic._id), clinic]),
    );

    const countByClinic = new Map(
      counts.map((item) => [String(item._id), item.n]),
    );

    return branches
      .filter((branch) => clinicById.has(String(branch.clinicId)))
      .map((branch) =>
        this.toInfo(
          clinicById.get(String(branch.clinicId)),
          branch,
          countByClinic.get(String(branch.clinicId)) ?? 1,
        ),
      )
      .filter((info) => info.visible);
  }

  async bookableBranch(branchId: string): Promise<BranchInfo> {
    if (!Types.ObjectId.isValid(branchId)) {
      throw new NotFoundException('Clinic not found');
    }

    const [info] = await this.branches([new Types.ObjectId(branchId)]);

    if (!info || !info.visible) {
      throw new NotFoundException('Clinic not found');
    }

    if (!info.portal.enabled || !info.portal.bookingEnabled) {
      throw new BadRequestException(
        'This clinic does not take online bookings yet. Please call the clinic.',
      );
    }

    return info;
  }

  /** Lists active clinics independently of portal booking settings. */
  async discover(q?: string, limit = 30): Promise<BranchInfo[]> {
    const filter: Record<string, unknown> = {
      $or: [{ status: ClinicStatus.Active }, { status: null }],
      isPlatformClinic: { $ne: true },
    };

    const searchText = (q ?? '').trim().slice(0, 80);

    const clinics = await this.clinicModel
      .find(
        searchText
          ? {
              ...filter,
              name: {
                $regex: escapeRegex(searchText),
                $options: 'i',
              },
            }
          : filter,
      )
      .limit(Math.min(50, Math.max(1, limit)))
      .lean();

    return this.branchesOfClinics(clinics.map((clinic) => clinic._id));
  }

  async doctorsFor(branches: BranchInfo[]): Promise<DoctorInfo[]> {
    const byClinic = new Map<string, BranchInfo[]>();

    for (const branch of branches) {
      const clinicId = String(branch.clinicId);
      const existing = byClinic.get(clinicId) ?? [];

      existing.push(branch);
      byClinic.set(clinicId, existing);
    }

    const output: DoctorInfo[] = [];

    for (const [clinicIdString, clinicBranches] of byClinic) {
      const clinicId = new Types.ObjectId(clinicIdString);

      const visibleBranches = clinicBranches.filter((branch) => branch.visible);

      const branchSet = new Set(
        visibleBranches.map((branch) => String(branch.branchId)),
      );

      if (!branchSet.size) continue;

      const portal = visibleBranches[0].portal;
      const doctors = await this.users.listDoctors(clinicId);

      if (!doctors.length) continue;

      const doctorIds = doctors.map(
        (doctor) => new Types.ObjectId(String(doctor._id)),
      );

      const [profiles, rules, visitTypes] = await Promise.all([
        this.profileModel
          .find({
            clinicId,
            userId: { $in: doctorIds },
          })
          .lean(),

        this.ruleModel
          .find({
            clinicId,
            doctorUserId: { $in: doctorIds },
            branchId: {
              $in: [...branchSet].map((id) => new Types.ObjectId(id)),
            },
            active: true,
          })
          .lean(),

        this.visitTypeModel
          .find({
            clinicId,
            doctorUserId: { $in: doctorIds },
            active: true,
          })
          .sort({ price: 1 })
          .lean(),
      ]);

      const profileById = new Map(
        profiles.map((profile) => [String(profile.userId), profile]),
      );

      for (const doctor of doctors) {
        const doctorId = String(doctor._id);

        const doctorRules = rules.filter(
          (rule) => String(rule.doctorUserId) === doctorId,
        );

        const doctorVisitTypes = visitTypes.filter(
          (visitType) => String(visitType.doctorUserId) === doctorId,
        );

        const profile = profileById.get(doctorId);

        const ruleBranches = [
          ...new Set(doctorRules.map((rule) => String(rule.branchId))),
        ];

        const assignedBranches = (doctor.branchIds ?? [])
          .map(String)
          .filter((id) => branchSet.has(id));

        const branchIds = [
          ...new Set(
            [...ruleBranches, ...assignedBranches].filter((id) =>
              branchSet.has(id),
            ),
          ),
        ];

        // Do not show doctors under unrelated branches.
        if (!branchIds.length) continue;

        const allowList = portal.bookableDoctorIds ?? [];

        const hasAvailabilityRule = doctorRules.some(
          (rule) =>
            branchIds.includes(String(rule.branchId)) &&
            (rule.windows ?? []).length > 0,
        );

        const bookable =
          portal.enabled &&
          portal.bookingEnabled &&
          hasAvailabilityRule &&
          (allowList.length === 0 || allowList.includes(doctorId));

        const doctorClinics = branchIds.map((branchId) => {
          const branchRules = doctorRules.filter(
            (rule) =>
              String(rule.branchId) === branchId &&
              (rule.windows ?? []).length > 0,
          );

          const days = branchRules.map((rule) => rule.weekday);
          const sample = branchRules[0];

          const schedule = [
            daysLabel(days),
            sample ? windowsLabel(sample.windows) : '',
          ]
            .filter(Boolean)
            .join(' · ');

          return {
            clinicId: branchId,
            schedule,
            days,
          };
        });

        const allDays = doctorClinics.flatMap(
          (clinic: { days: number[] }) => clinic.days,
        );

        const speciality = profile?.specialties?.[0] || 'General physician';

        const fee = doctorVisitTypes[0]?.price ?? 0;
        const name = doctor.name;

        output.push({
          clinicId,
          branchIds,
          minFee: fee,
          firstVisitTypeId: doctorVisitTypes[0]
            ? String(doctorVisitTypes[0]._id)
            : undefined,

          view: {
            id: doctorId,
            name,
            initials: initialsOf(name),
            color: colorFor(doctorId),
            speciality,
            specialityId: slug(speciality),
            qualifications: doctor.qualifications ?? '',
            regNo: doctor.registrationNumber,
            years: 0,
            fee,
            durationMin:
              doctorRules[0]?.slotMinutes || profile?.defaultSlotMinutes || 15,
            languages: [],
            about: '',
            clinics: doctorClinics,
            availabilityNote: daysLabel(allDays),
            seenBefore: false,
            pronoun: 'them',
            bookable,
          },
        });
      }
    }

    return output;
  }

  async bookableDoctor(
    info: BranchInfo,
    doctorId: string,
  ): Promise<DoctorInfo> {
    if (!Types.ObjectId.isValid(doctorId)) {
      throw new NotFoundException('Doctor not found');
    }

    const [doctor] = (await this.doctorsFor([info])).filter(
      (item) => item.view.id === doctorId,
    );

    if (
      !doctor ||
      !doctor.view.bookable ||
      !doctor.branchIds.includes(String(info.branchId))
    ) {
      throw new NotFoundException('Doctor not found');
    }

    return doctor;
  }

  clinicView(
    info: BranchInfo,
    doctors: DoctorInfo[],
    visited: boolean,
  ): PortalClinicView {
    const branch = info.branch;
    const id = String(info.branchId);

    const doctorsHere = doctors.filter((doctor) =>
      doctor.branchIds.includes(id),
    );

    const fees = doctorsHere
      .map((doctor) => doctor.minFee)
      .filter((fee) => fee > 0);

    const name =
      info.branchCount > 1
        ? `${info.clinicName} – ${branch.name}`
        : info.clinicName;

    const address =
      branch.addressLine || legacyAddressLine(branch.address) || '';

    const area =
      info.branchCount > 1
        ? branch.name
        : String((branch.address as any)?.city ?? '') || branch.name || '';

    const open = hhmmToLabel(branch.workingHours?.open);
    const close = hhmmToLabel(branch.workingHours?.close);

    return {
      id,
      tenantId: String(info.clinicId),
      name,
      short: info.clinicName.split(/\s+/)[0] ?? info.clinicName,
      initials: initialsOf(info.clinicName),
      area,
      address,
      phone: branch.phone ?? '',
      distanceKm: -1,
      doctorCount: doctorsHere.length,
      hours: open && close ? `${open} – ${close}` : '',
      openUntil: close,
      feesFrom: fees.length ? Math.min(...fees) : 0,
      color: colorFor(String(info.clinicId)),
      gradient: gradientFor(String(info.clinicId)),
      services: [],
      tags: visited ? ["You've visited"] : [],
      bookingEnabled:
        info.visible && info.portal.enabled && info.portal.bookingEnabled,
      cancellationLeadTimeHours: info.portal.cancellationLeadTimeHours,
      maxAdvanceDays: info.portal.maxAdvanceDays,
    };
  }

  specialities(doctors: PortalDoctorView[]): PortalSpecialityView[] {
    const map = new Map<string, PortalSpecialityView>();

    for (const doctor of doctors) {
      const speciality = map.get(doctor.specialityId) ?? {
        id: doctor.specialityId,
        label: doctor.speciality,
        doctorCount: 0,
      };

      speciality.doctorCount += 1;
      map.set(doctor.specialityId, speciality);
    }

    return [...map.values()].sort((a, b) => b.doctorCount - a.doctorCount);
  }

  todayIn(timezone: string): string {
    return DateTime.now().setZone(timezone).toISODate()!;
  }

  assertBookableDate(info: BranchInfo, date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('date must be YYYY-MM-DD');
    }

    const parsed = DateTime.fromISO(date, { zone: info.timezone });

    if (!parsed.isValid || parsed.toISODate() !== date) {
      throw new BadRequestException('Invalid booking date');
    }

    const today = this.todayIn(info.timezone);

    if (date < today) {
      throw new BadRequestException('Pick a date from today onwards');
    }

    const last = DateTime.fromISO(today, {
      zone: info.timezone,
    })
      .plus({ days: info.portal.maxAdvanceDays })
      .toISODate()!;

    if (date > last) {
      throw new BadRequestException(
        `This clinic takes bookings up to ${info.portal.maxAdvanceDays} days ahead`,
      );
    }
  }

  async slots(
    info: BranchInfo,
    doctorId: string,
    date: string,
    ignoreAppointmentId?: string,
  ) {
    if (!info.portal.enabled || !info.portal.bookingEnabled) {
      throw new BadRequestException(
        'This clinic does not take online bookings yet.',
      );
    }

    if (!Types.ObjectId.isValid(doctorId)) {
      throw new NotFoundException('Doctor not found');
    }

    this.assertBookableDate(info, date);

    const day = await this.appointments.availableSlots({
      clinicId: info.clinicId,
      branchId: String(info.branchId),
      doctorId,
      date,
    });

    const rawSlots = day.slots.map((slot: any) =>
      slot.status === 'booked' &&
      ignoreAppointmentId &&
      slot.bookedBy?.apptId === ignoreAppointmentId
        ? {
            startAt: slot.startAt,
            endAt: slot.endAt,
            status: 'available',
          }
        : {
            startAt: slot.startAt,
            endAt: slot.endAt,
            status: slot.status,
          },
    );

    return {
      raw: rawSlots,
      groups: toSlotGroups(rawSlots, info.timezone) as PortalSlotGroupView[],
    };
  }

  async nextAvailable(
    info: BranchInfo,
    doctorId: string,
  ): Promise<NextAvailableValue> {
    if (!Types.ObjectId.isValid(doctorId)) {
      return null;
    }

    // Preserve clinic booking restrictions.
    if (!info.portal.enabled || !info.portal.bookingEnabled) {
      return null;
    }

    const today = this.todayIn(info.timezone);
    const cacheKey = `${info.branchId}|${doctorId}|${today}`;

    const cached = this.nextCache.get(cacheKey);

    if (cached && Date.now() - cached.at < NEXT_CACHE_MS) {
      return cached.value;
    }

    const horizon = Math.min(NEXT_HORIZON_DAYS, info.portal.maxAdvanceDays + 1);

    let next: NextAvailableValue = null;

    for (let offset = 0; offset < horizon; offset++) {
      const date = DateTime.fromISO(today, {
        zone: info.timezone,
      })
        .plus({ days: offset })
        .toISODate();

      if (!date) continue;

      try {
        const { groups } = await this.slots(info, doctorId, date);

        const times = groups
          .flatMap((group) => group.slots)
          .filter((slot) => !slot.booked)
          .map((slot) => slot.time)
          .filter(Boolean);

        if (times.length > 0) {
          next = {
            date,
            times: [...new Set(times)].sort(),
          };
          break;
        }
      } catch (error) {
        // Do not silently treat configuration errors as available slots.
        // Log the error so backend logs reveal the cause.
        console.error(
          `[Portal Availability] Failed for branch=${info.branchId}, doctor=${doctorId}, date=${date}`,
          error,
        );
        throw error;
      }
    }

    if (this.nextCache.size > 5000) {
      this.nextCache.clear();
    }

    this.nextCache.set(cacheKey, {
      at: Date.now(),
      value: next,
    });

    return next;
  }

  invalidateNext(
    branchId: Types.ObjectId,
    doctorId: Types.ObjectId | string,
  ): void {
    const prefix = `${branchId}|${doctorId}|`;

    for (const key of this.nextCache.keys()) {
      if (key.startsWith(prefix)) {
        this.nextCache.delete(key);
      }
    }
  }
}
