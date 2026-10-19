import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  PatientIdentitiesService,
  type ProfilePatch,
} from '../../patient-identities/patient-identities.service';
import { RecordAccessService } from '../../record-access/record-access.service';
import { RecordAccessSource } from '../../record-access/schemas/record-access-grant.schema';
import { PortalDirectoryService } from './portal-directory.service';
import { PortalScopeService } from './portal-scope.service';
import { PortalRecordsService } from './portal-records.service';
import { PortalAppointmentsService } from './portal-appointments.service';
import { PortalFamilyService } from './portal-family.service';
import type { PortalCtx } from '../portal.context';
import type {
  PortalAppointmentView,
  PortalDataView,
  PortalDoctorView,
  PortalFamilyMemberView,
  PortalInvoiceView,
  PortalNotificationView,
  PortalPatientView,
  PortalPrivacyView,
  PortalReportView,
} from '../views/portal-view.types';
import { colorFor, initialsOf, toPatientView } from '../views/portal.mappers';

@Injectable()
export class PortalMeService {
  constructor(
    private readonly identities: PatientIdentitiesService,
    private readonly recordAccess: RecordAccessService,
    private readonly directory: PortalDirectoryService,
    private readonly scope: PortalScopeService,
    private readonly records: PortalRecordsService,
    private readonly appointments: PortalAppointmentsService,
    private readonly family: PortalFamilyService,
  ) {}

  async patient(ctx: PortalCtx): Promise<PortalPatientView> {
    const links = await this.identities.activeLinks(ctx.accountId);
    return toPatientView(ctx.account, {
      dobLocked: links.length > 0 && !!ctx.account.dob,
    });
  }

  /** Save the profile, then link any clinic charts that match the verified number. */
  async updateProfile(ctx: PortalCtx, patch: ProfilePatch) {
    await this.identities.updateProfile(ctx.account, patch);
    const linked = await this.identities.syncLinks(ctx.account);
    return { patient: await this.patient(ctx), linkedRecords: linked };
  }

  async updatePrivacy(
    ctx: PortalCtx,
    patch: { appLock?: boolean; hidePreviews?: boolean },
  ) {
    await this.identities.updatePrivacy(ctx.account, patch);
  }

  /** Clinic ids (tenant) a portal "clinic" (branch) belongs to. */
  private async tenantOf(branchId: string): Promise<Types.ObjectId | null> {
    if (!Types.ObjectId.isValid(branchId)) return null;
    const [info] = await this.directory.branches([
      new Types.ObjectId(branchId),
    ]);
    return info?.visible ? info.clinicId : null;
  }

  /** Turn sharing of the caller's other records with one clinic on or off. */
  async setClinicSharing(ctx: PortalCtx, branchId: string, enabled: boolean) {
    const clinicId = await this.tenantOf(branchId);
    if (!clinicId) return { ok: false };
    await this.recordAccess.set({
      accountId: ctx.accountId,
      clinicId,
      enabled,
      source: RecordAccessSource.PrivacySetting,
    });
    return { ok: true };
  }

  async privacy(
    ctx: PortalCtx,
    branchIdsByTenant: Map<string, string[]>,
  ): Promise<PortalPrivacyView> {
    const grants = await this.recordAccess.listActive(ctx.accountId);
    const clinicSharing: Record<string, boolean> = {};
    for (const [tenant, branches] of branchIdsByTenant) {
      const on = grants.some((g) => String(g.granteeClinicId) === tenant);
      for (const b of branches) clinicSharing[b] = on;
    }
    return {
      clinicSharing,
      appLock: !!ctx.account.privacy?.appLock,
      hidePreviews: !!ctx.account.privacy?.hidePreviews,
    };
  }

  markRead(ctx: PortalCtx, ids?: string[]) {
    return this.identities.markNotificationsRead(ctx.account, ids);
  }

  /**
   * Notifications are derived from current data rather than stored, so the
   * clinic app does not have to emit anything for them.
   */
  notifications(
    ctx: PortalCtx,
    input: {
      appointments: PortalAppointmentView[];
      reports: PortalReportView[];
      invoices: PortalInvoiceView[];
      family: PortalFamilyMemberView[];
      doctorName: (id?: string) => string;
      today: string;
    },
  ): PortalNotificationView[] {
    const read = new Set(ctx.account.readNotificationIds ?? []);
    const readAllAt = ctx.account.notificationsReadAllAt?.getTime() ?? 0;
    const out: Array<PortalNotificationView & { at: number }> = [];
    const tomorrow = DateTime.fromISO(input.today)
      .plus({ days: 1 })
      .toISODate()!;

    for (const a of input.appointments) {
      if (
        a.status !== 'confirmed' ||
        (a.date !== input.today && a.date !== tomorrow)
      )
        continue;
      out.push({
        id: `appt:${a.id}:${a.date}`,
        kind: 'appointment',
        title:
          a.date === input.today ? 'Appointment today' : 'Appointment tomorrow',
        body: `${a.time} with ${input.doctorName(a.doctorId)}`,
        when: '',
        group: 'Today',
        unread: true,
        to: `/appointments/${a.id}`,
        at: a.startAt ? new Date(a.startAt).getTime() - 86_400_000 : Date.now(),
      });
    }
    for (const r of input.reports.filter((x) => x.isNew)) {
      out.push({
        id: `report:${r.id}`,
        kind: 'records',
        title: 'New report added',
        body: r.title,
        when: '',
        group: 'Today',
        unread: true,
        to: `/reports/${r.id}`,
        at: DateTime.fromISO(r.date).toMillis(),
      });
    }
    for (const inv of input.invoices.filter(
      (i) => i.status === 'due' && i.outstanding > 0,
    )) {
      out.push({
        id: `bill:${inv.id}`,
        kind: 'payment',
        title: 'Bill due',
        body: `${inv.title} · ₹${inv.outstanding}`,
        when: '',
        group: 'Earlier',
        unread: true,
        to: `/billing/${inv.id}`,
        at: DateTime.fromISO(inv.date).toMillis(),
      });
    }
    for (const m of input.family.filter(
      (f) => f.kind === 'pending' && f.incoming,
    )) {
      out.push({
        id: `family:${m.connectionId}`,
        kind: 'family',
        title: 'Family request',
        body: `${m.name} wants to connect with you`,
        when: '',
        group: 'Today',
        unread: true,
        to: '/family',
        at: Date.now(),
      });
    }
    const now = DateTime.now();
    return out
      .sort((a, b) => b.at - a.at)
      .slice(0, 50)
      .map(({ at, ...n }) => {
        const dt = DateTime.fromMillis(Math.min(at, now.toMillis()));
        const isToday = dt.hasSame(now, 'day');
        return {
          ...n,
          group: isToday ? 'Today' : 'Earlier',
          when: isToday ? 'Today' : (dt.toRelative() ?? ''),
          unread: !read.has(n.id) && at > readAllAt,
        };
      });
  }

  /** Everything the portal client loads after sign-in, in its own shapes. */
  async bootstrap(ctx: PortalCtx): Promise<PortalDataView> {
    const [patient, bundle, appointments, family, bookLinks] =
      await Promise.all([
        this.patient(ctx),
        this.records.bundle(ctx),
        this.appointments.list(ctx),
        this.family.list(ctx),
        this.scope.links(ctx, 'book'),
      ]);

    // Clinics: every branch the person has records at, plus discoverable ones.
    const recordBranchIds = new Set<string>([
      ...appointments.map((a) => a.clinicId),
      ...bundle.visits.map((v) => v.clinicId),
      ...bundle.prescriptions.map((p) => p.clinicId),
      ...bundle.invoices.map((i) => i.clinicId),
      ...bundle.reports.map((r) => r.clinicId).filter((x): x is string => !!x),
    ]);
    const ownClinics = await this.directory.branchesOfClinics(
      [...new Set(bookLinks.map((l) => String(l.clinicId)))].map(
        (s) => new Types.ObjectId(s),
      ),
    );
    const discovered = await this.directory.discover(undefined, 30);
    const extra = await this.directory.branches(
      [...recordBranchIds]
        .filter(
          (id) =>
            Types.ObjectId.isValid(id) &&
            !ownClinics.some((b) => String(b.branchId) === id),
        )
        .map((id) => new Types.ObjectId(id)),
    );
    const branchMap = new Map<string, (typeof discovered)[number]>();
    for (const b of [...ownClinics, ...extra, ...discovered])
      branchMap.set(String(b.branchId), b);
    const branches = [...branchMap.values()];

    const doctorInfos = await this.directory.doctorsFor(
      branches.filter((b) => b.visible),
    );
    const seen = new Set(
      appointments.map((a) => a.doctorId).filter(Boolean) as string[],
    );
    const doctors: PortalDoctorView[] = doctorInfos.map((d) => ({
      ...d.view,
      seenBefore: seen.has(d.view.id),
    }));
    // Doctors who only appear in records (left the clinic, or not bookable).
    for (const ref of bundle.doctors) {
      if (doctors.some((d) => d.id === ref.id)) continue;
      doctors.push({
        id: ref.id,
        name: ref.name,
        initials: initialsOf(ref.name),
        color: colorFor(ref.id),
        speciality: 'Doctor',
        specialityId: 'doctor',
        qualifications: '',
        years: 0,
        fee: 0,
        durationMin: 15,
        languages: [],
        about: '',
        clinics: [{ clinicId: ref.clinicId, schedule: '', days: [] }],
        availabilityNote: '',
        seenBefore: true,
        pronoun: 'them',
        bookable: false,
      });
    }

    const visited = new Set([...recordBranchIds]);
    const clinics = branches.map((b) =>
      this.directory.clinicView(
        b,
        doctorInfos,
        visited.has(String(b.branchId)),
      ),
    );
    const byTenant = new Map<string, string[]>();
    for (const b of branches) {
      byTenant.set(String(b.clinicId), [
        ...(byTenant.get(String(b.clinicId)) ?? []),
        String(b.branchId),
      ]);
    }
    const tz =
      ownClinics[0]?.timezone ?? discovered[0]?.timezone ?? 'Asia/Kolkata';
    const today = DateTime.now().setZone(tz).toISODate()!;
    const doctorName = (id?: string) =>
      doctors.find((d) => d.id === id)?.name ?? 'your doctor';

    return {
      patient,
      clinics,
      doctors,
      specialities: this.directory.specialities(
        doctors.filter((d) => d.bookable),
      ),
      appointments,
      records: bundle.records,
      visits: bundle.visits,
      reports: bundle.reports,
      prescriptions: bundle.prescriptions,
      invoices: bundle.invoices,
      family,
      notifications: this.notifications(ctx, {
        appointments,
        reports: bundle.reports,
        invoices: bundle.invoices,
        family,
        doctorName,
        today,
      }),
      privacy: await this.privacy(ctx, byTenant),
      today,
    };
  }
}
