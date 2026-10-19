import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import {
  Encounter,
  EncounterStatus,
} from '../../encounters/schemas/encounter.schema';
import { Prescription } from '../../prescriptions/schemas/prescription.schema';
import { PrescriptionsService } from '../../prescriptions/prescriptions.service';
import {
  Document,
  DocumentOwnerType,
  DocumentStatus,
} from '../../documents/schemas/document.schema';
import { DocumentsService } from '../../documents/documents.service';
import { Bill, BillStatus } from '../../billing/schemas/bill.schema';
import { Payment } from '../../billing/schemas/payment.schema';
import { BillingService } from '../../billing/billing.service';
import { ServiceCatalogItem } from '../../billing/schemas/service-catalog-item.schema';
import { Appointment } from '../../appointments/schemas/appointment.schema';
import { User } from '../../authz/schemas/user.schema';
import { Patient } from '../../patients/schemas/patient.schema';
import { Branch } from '../../tenancy/schemas/branch.schema';
import { MedicineCatalogItem } from '../../medicines/schemas/medicine-catalog-item.schema';
import { StorageService } from '../../storage/storage.service';
import type { FamilyCapability } from '../../family/schemas/family-grant.schema';
import { PortalScopeService, type SubjectLink } from './portal-scope.service';
import { touch, type PortalCtx } from '../portal.context';
import {
  isBillVisible,
  localDate,
  localTime,
  reportCategory,
  thumbFor,
  titleFromFileName,
  toInvoiceView,
  toPrescriptionView,
} from '../views/portal.mappers';
import type {
  PortalInvoiceView,
  PortalPrescriptionView,
  PortalRecordView,
  PortalReportView,
  PortalVisitView,
} from '../views/portal-view.types';

/** A doctor referenced by a record, so the client can show their name. */
export type DoctorRef = { id: string; name: string; clinicId: string };

export type RecordsBundle = {
  visits: PortalVisitView[];
  reports: PortalReportView[];
  prescriptions: PortalPrescriptionView[];
  invoices: PortalInvoiceView[];
  records: PortalRecordView[];
  doctors: DoctorRef[];
};

/** Owner types a patient sees as "reports"; bill and Rx PDFs live in their own sections. */
const REPORT_OWNER_TYPES = [
  DocumentOwnerType.Patient,
  DocumentOwnerType.Encounter,
  DocumentOwnerType.Appointment,
];

const PRESIGN_SECONDS = 300;

const VITALS: Array<[string, string, string]> = [
  ['bpSystolic', 'Blood pressure', 'mmHg'],
  ['pulseBpm', 'Pulse', 'bpm'],
  ['temperatureC', 'Temperature', '°C'],
  ['spo2', 'SpO₂', '%'],
  ['weightKg', 'Weight', 'kg'],
  ['heightCm', 'Height', 'cm'],
  ['respiratoryRate', 'Resp. rate', '/min'],
];

/**
 * Read-only clinical and billing records for the portal. Queries are always
 * scoped by (clinicId, patientId) pairs resolved from the caller's links —
 * a record id from the client is only ever used after that ownership check.
 */
@Injectable()
export class PortalRecordsService {
  constructor(
    @InjectModel(Encounter.name)
    private readonly encounterModel: Model<Encounter>,
    @InjectModel(Prescription.name)
    private readonly rxModel: Model<Prescription>,
    @InjectModel(Document.name) private readonly docModel: Model<Document>,
    @InjectModel(Bill.name) private readonly billModel: Model<Bill>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    @InjectModel(ServiceCatalogItem.name)
    private readonly serviceModel: Model<ServiceCatalogItem>,
    @InjectModel(Appointment.name)
    private readonly apptModel: Model<Appointment>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(MedicineCatalogItem.name)
    private readonly medModel: Model<MedicineCatalogItem>,
    private readonly prescriptions: PrescriptionsService,
    private readonly documents: DocumentsService,
    private readonly billing: BillingService,
    private readonly storage: StorageService,
    private readonly scope: PortalScopeService,
  ) {}

  /**
   * Everything the caller may see, across every clinic:
   *  visits — themselves and dependants only (no family grant covers them);
   *  prescriptions / reports / bills — plus adults who granted rx / reports / bills.
   */
  async bundle(ctx: PortalCtx): Promise<RecordsBundle> {
    const [rxLinks, reportLinks, billLinks] = await Promise.all([
      this.scope.links(ctx, 'rx'),
      this.scope.links(ctx, 'reports'),
      this.scope.links(ctx, 'bills'),
    ]);
    const visitLinks = rxLinks.filter((l) => l.subject.relation !== 'family');
    const out: RecordsBundle = {
      visits: [],
      reports: [],
      prescriptions: [],
      invoices: [],
      records: [],
      doctors: [],
    };
    const doctorRefs = new Map<string, DoctorRef>();

    const [visits, prescriptions, reports, invoices] = await Promise.all([
      this.visitsFor(ctx, visitLinks, doctorRefs),
      this.prescriptionsFor(ctx, rxLinks, doctorRefs),
      this.reportsFor(ctx, reportLinks),
      this.invoicesFor(ctx, billLinks),
    ]);
    out.visits = visits;
    out.prescriptions = prescriptions;
    out.reports = reports;
    out.invoices = invoices;
    out.doctors = [...doctorRefs.values()];

    const doctorName = (id: string) => doctorRefs.get(id)?.name ?? 'Clinic';
    out.records = [
      ...visits.map<PortalRecordView>((v) => ({
        id: `rec-v-${v.id}`,
        type: 'visit',
        date: v.date,
        clinicId: v.clinicId,
        title: v.title,
        who: doctorName(v.doctorId),
        summary: v.diagnosis ?? '',
        to: `/records/visits/${v.id}`,
        patientId: v.patientId,
      })),
      ...reports.map<PortalRecordView>((r) => ({
        id: `rec-r-${r.id}`,
        type: 'lab',
        date: r.date,
        clinicId: r.clinicId ?? '',
        title: r.title,
        who: r.orderedBy ?? 'Clinic upload',
        summary: '',
        to: `/reports/${r.id}`,
        patientId: r.patientId,
      })),
      ...prescriptions.map<PortalRecordView>((p) => ({
        id: `rec-p-${p.id}`,
        type: 'rx',
        date: p.date,
        clinicId: p.clinicId,
        title: p.title,
        who: doctorName(p.doctorId),
        summary: p.medicines
          .map((m) => m.name)
          .slice(0, 3)
          .join(', '),
        to: `/prescriptions/${p.id}`,
        patientId: p.patientId,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return out;
  }

  private today(tz: string) {
    return DateTime.now().setZone(tz).toISODate()!;
  }

  private async doctorNames(clinicId: Types.ObjectId, ids: Types.ObjectId[]) {
    if (!ids.length) return new Map<string, string>();
    const users = await this.userModel
      .find({ clinicId, _id: { $in: ids } })
      .select({ name: 1 })
      .lean();
    return new Map(users.map((u) => [String(u._id), u.name]));
  }

  // --- Visits ----------------------------------------------------------------

  private async visitsFor(
    ctx: PortalCtx,
    links: SubjectLink[],
    refs: Map<string, DoctorRef>,
  ) {
    const out: PortalVisitView[] = [];
    for (const l of links) {
      const encounters = await this.encounterModel
        .find({
          clinicId: l.clinicId,
          patientId: l.patientId,
          status: EncounterStatus.Signed,
        })
        .sort({ visitedAt: -1 })
        .limit(200)
        .lean();
      if (!encounters.length) continue;
      touch(ctx, l.clinicId);
      const encIds = encounters.map((e) => e._id);
      const [names, rx, docs, bills] = await Promise.all([
        this.doctorNames(
          l.clinicId,
          encounters.map((e) => e.doctorId),
        ),
        this.rxModel
          .find({ clinicId: l.clinicId, encounterId: { $in: encIds } })
          .select({ encounterId: 1 })
          .lean(),
        this.docModel
          .find({
            clinicId: l.clinicId,
            ownerType: DocumentOwnerType.Encounter,
            ownerId: { $in: encIds },
            deletedAt: null,
            status: DocumentStatus.Available,
          })
          .select({ ownerId: 1 })
          .lean(),
        this.billModel
          .find({
            clinicId: l.clinicId,
            encounterId: { $in: encIds },
            status: { $ne: BillStatus.Draft },
          })
          .select({ encounterId: 1 })
          .lean(),
      ]);
      const first = (rows: any[], key: string) => {
        const m = new Map<string, string>();
        for (const r of rows)
          if (!m.has(String(r[key]))) m.set(String(r[key]), String(r._id));
        return m;
      };
      const rxBy = first(rx, 'encounterId');
      const docBy = first(docs, 'ownerId');
      const billBy = first(bills, 'encounterId');
      for (const e of encounters as any[]) {
        const did = String(e.doctorId);
        refs.set(did, {
          id: did,
          name: names.get(did) ?? 'Doctor',
          clinicId: String(e.branchId),
        });
        const primary =
          (e.diagnoses ?? []).find((d: any) => d.primary) ?? e.diagnoses?.[0];
        const v = e.vitals ?? {};
        const vitals = VITALS.filter(([k]) => v[k] != null).map(
          ([k, label, unit]) => ({
            label,
            value:
              k === 'bpSystolic' && v.bpDiastolic != null
                ? `${v.bpSystolic}/${v.bpDiastolic}`
                : String(v[k]),
            unit,
          }),
        );
        out.push({
          id: String(e._id),
          date: localDate(e.visitedAt, l.timezone),
          time: localTime(e.visitedAt, l.timezone),
          clinicId: String(e.branchId),
          doctorId: did,
          title: primary?.description || e.chiefComplaint || 'Consultation',
          mode: 'In clinic',
          vitals: vitals.length ? vitals : undefined,
          diagnosis:
            (e.diagnoses ?? [])
              .map((d: any) => d.description)
              .filter(Boolean)
              .join(', ') || undefined,
          // The clinician's free-text notes stay in the clinic; the patient
          // sees what they came in with and the follow-up advice.
          notes: [e.chiefComplaint, e.followUpNotes].filter(Boolean).join('\n'),
          prescriptionId: rxBy.get(String(e._id)),
          reportId: docBy.get(String(e._id)),
          invoiceId: billBy.get(String(e._id)),
          followUp: e.followUpAt
            ? localDate(e.followUpAt, l.timezone)
            : undefined,
          patientId: l.subject.account._id.toHexString(),
        });
      }
    }
    return out;
  }

  async visit(ctx: PortalCtx, id: string): Promise<PortalVisitView> {
    const enc = await this.load(this.encounterModel, id, 'Visit not found');
    const link = await this.scope.linkFor(
      ctx,
      enc.clinicId,
      enc.patientId,
      'rx',
    );
    if (
      !link ||
      link.subject.relation === 'family' ||
      enc.status !== EncounterStatus.Signed
    ) {
      throw new NotFoundException('Visit not found');
    }
    const [view] = (await this.visitsFor(ctx, [link], new Map())).filter(
      (v) => v.id === id,
    );
    if (!view) throw new NotFoundException('Visit not found');
    return view;
  }

  // --- Prescriptions -----------------------------------------------------------

  /**
   * A prescription is shown once it is final: its consultation was signed,
   * or the clinic has already printed or shared it.
   */
  private async prescriptionsFor(
    ctx: PortalCtx,
    links: SubjectLink[],
    refs: Map<string, DoctorRef>,
  ) {
    const out: PortalPrescriptionView[] = [];
    for (const l of links) {
      const rxs = await this.rxModel
        .find({ clinicId: l.clinicId, patientId: l.patientId })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      if (!rxs.length) continue;
      const encs = await this.encounterModel
        .find({
          clinicId: l.clinicId,
          _id: { $in: rxs.map((r) => r.encounterId) },
        })
        .select({
          status: 1,
          diagnoses: 1,
          chiefComplaint: 1,
          followUpNotes: 1,
        })
        .lean();
      const encBy = new Map(encs.map((e) => [String(e._id), e as any]));
      const visible = rxs.filter(
        (r: any) =>
          encBy.get(String(r.encounterId))?.status === EncounterStatus.Signed ||
          r.pdfDocumentId ||
          r.shareToken,
      );
      if (!visible.length) continue;
      touch(ctx, l.clinicId);
      const catalogIds = visible.flatMap((r: any) =>
        (r.items ?? [])
          .map((i: any) => i.medicineCatalogItemId)
          .filter(Boolean),
      );
      const [names, meds] = await Promise.all([
        this.doctorNames(
          l.clinicId,
          visible.map((r) => r.doctorId),
        ),
        catalogIds.length
          ? this.medModel
              .find({ clinicId: l.clinicId, _id: { $in: catalogIds } })
              .select({ name: 1 })
              .lean()
          : [],
      ]);
      const medName = new Map(meds.map((m: any) => [String(m._id), m.name]));
      const today = this.today(l.timezone);
      for (const r of visible as any[]) {
        const did = String(r.doctorId);
        refs.set(did, {
          id: did,
          name: names.get(did) ?? 'Doctor',
          clinicId: String(r.branchId),
        });
        const enc = encBy.get(String(r.encounterId));
        const primary =
          (enc?.diagnoses ?? []).find((d: any) => d.primary) ??
          enc?.diagnoses?.[0];
        out.push(
          toPrescriptionView({
            rx: r,
            subjectId: l.subject.account._id.toHexString(),
            branchId: String(r.branchId),
            tz: l.timezone,
            today,
            title:
              primary?.description ||
              enc?.chiefComplaint ||
              `Prescription ${r.prescriptionNo ?? ''}`.trim(),
            medicineName: (i) =>
              i.customName ||
              medName.get(String(i.medicineCatalogItemId)) ||
              'Medicine',
            advice: enc?.followUpNotes ? [enc.followUpNotes] : [],
          }),
        );
      }
    }
    return out;
  }

  // --- Reports (documents) -----------------------------------------------------

  private async reportsFor(ctx: PortalCtx, links: SubjectLink[]) {
    const out: PortalReportView[] = [];
    for (const l of links) {
      const [encs, appts, patient] = await Promise.all([
        this.encounterModel
          .find({ clinicId: l.clinicId, patientId: l.patientId })
          .select({ branchId: 1, doctorId: 1 })
          .lean(),
        this.apptModel
          .find({ clinicId: l.clinicId, patientId: l.patientId })
          .select({ branchId: 1 })
          .lean(),
        this.patientModel
          .findOne({ _id: l.patientId, clinicId: l.clinicId })
          .select({ primaryBranchId: 1 })
          .lean(),
      ]);
      const docs = await this.docModel
        .find({
          clinicId: l.clinicId,
          deletedAt: null,
          status: DocumentStatus.Available,
          $or: [
            { ownerType: DocumentOwnerType.Patient, ownerId: l.patientId },
            ...(encs.length
              ? [
                  {
                    ownerType: DocumentOwnerType.Encounter,
                    ownerId: { $in: encs.map((e) => e._id) },
                  },
                ]
              : []),
            ...(appts.length
              ? [
                  {
                    ownerType: DocumentOwnerType.Appointment,
                    ownerId: { $in: appts.map((a) => a._id) },
                  },
                ]
              : []),
          ],
        })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      if (!docs.length) continue;
      touch(ctx, l.clinicId);
      const encBy = new Map(encs.map((e) => [String(e._id), e]));
      const apptBy = new Map(appts.map((a) => [String(a._id), a]));
      const fallbackBranch =
        patient?.primaryBranchId ??
        (
          await this.branchModel
            .findOne({ clinicId: l.clinicId })
            .select({ _id: 1 })
            .lean()
        )?._id;
      const names = await this.doctorNames(
        l.clinicId,
        encs.map((e) => e.doctorId),
      );
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      for (const d of docs as any[]) {
        const enc =
          d.ownerType === DocumentOwnerType.Encounter
            ? encBy.get(String(d.ownerId))
            : undefined;
        const appt =
          d.ownerType === DocumentOwnerType.Appointment
            ? apptBy.get(String(d.ownerId))
            : undefined;
        const branch = enc?.branchId ?? appt?.branchId ?? fallbackBranch;
        const id = String(d._id);
        const title = titleFromFileName(d.fileName);
        out.push({
          id,
          title,
          shortName: title.split(' ').slice(0, 2).join(' '),
          clinicId: branch ? String(branch) : undefined,
          date: localDate(d.createdAt, l.timezone),
          category: reportCategory(d.category),
          isNew: new Date(d.createdAt).getTime() > weekAgo,
          thumb: thumbFor(id),
          orderedBy: enc ? names.get(String(enc.doctorId)) : undefined,
          pages: 1,
          mimeType: d.mimeType,
          patientId: l.subject.account._id.toHexString(),
        });
      }
    }
    return out;
  }

  /** Presigned link to a report the caller may see (reports capability). */
  async reportDownload(ctx: PortalCtx, id: string) {
    const doc = await this.load(this.docModel, id, 'Report not found');
    if (
      doc.deletedAt ||
      doc.status !== DocumentStatus.Available ||
      !REPORT_OWNER_TYPES.includes(doc.ownerType)
    ) {
      throw new NotFoundException('Report not found');
    }
    let patientId: Types.ObjectId | undefined;
    if (doc.ownerType === DocumentOwnerType.Patient) patientId = doc.ownerId;
    else if (doc.ownerType === DocumentOwnerType.Encounter) {
      patientId = (
        await this.encounterModel
          .findOne({ _id: doc.ownerId, clinicId: doc.clinicId })
          .select({ patientId: 1 })
          .lean()
      )?.patientId;
    } else {
      patientId = (
        await this.apptModel
          .findOne({ _id: doc.ownerId, clinicId: doc.clinicId })
          .select({ patientId: 1 })
          .lean()
      )?.patientId;
    }
    if (
      !patientId ||
      !(await this.scope.linkFor(ctx, doc.clinicId, patientId, 'reports'))
    ) {
      throw new NotFoundException('Report not found');
    }
    return this.presign(
      ctx,
      doc.clinicId,
      doc._id,
      doc.storageKey,
      doc.mimeType,
    );
  }

  // --- Bills -------------------------------------------------------------------

  private async invoicesFor(ctx: PortalCtx, links: SubjectLink[]) {
    const out: PortalInvoiceView[] = [];
    for (const l of links) {
      const bills = await this.billModel
        .find({
          clinicId: l.clinicId,
          patientId: l.patientId,
          status: { $ne: BillStatus.Draft },
        })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      if (!bills.length) continue;
      const [payments, encs, appts] = await Promise.all([
        this.paymentModel
          .find({
            clinicId: l.clinicId,
            billId: { $in: bills.map((b) => b._id) },
          })
          .lean(),
        this.encounterModel
          .find({
            clinicId: l.clinicId,
            _id: { $in: bills.map((b) => b.encounterId).filter(Boolean) },
          })
          .select({ doctorId: 1 })
          .lean(),
        this.apptModel
          .find({
            clinicId: l.clinicId,
            _id: { $in: bills.map((b) => b.appointmentId).filter(Boolean) },
          })
          .select({ doctorId: 1 })
          .lean(),
      ]);
      const serviceIds = bills.flatMap((b: any) =>
        (b.items ?? []).map((i: any) => i.serviceCatalogItemId).filter(Boolean),
      );
      const services = serviceIds.length
        ? await this.serviceModel
            .find({ clinicId: l.clinicId, _id: { $in: serviceIds } })
            .select({ name: 1 })
            .lean()
        : [];
      const serviceName = new Map(
        services.map((s: any) => [String(s._id), s.name]),
      );
      const doctorOf = new Map<string, string>([
        ...encs.map(
          (e) => [String(e._id), String(e.doctorId)] as [string, string],
        ),
        ...appts.map(
          (a) => [String(a._id), String(a.doctorId)] as [string, string],
        ),
      ]);
      for (const b of bills as any[]) {
        const pays = payments.filter((p) => p.billId.equals(b._id));
        const paid = pays.reduce((s, p) => s + p.amount, 0);
        if (!isBillVisible(b, paid)) continue;
        touch(ctx, l.clinicId);
        out.push(
          toInvoiceView({
            bill: b,
            payments: pays,
            subjectId: l.subject.account._id.toHexString(),
            branchId: String(b.branchId),
            doctorId: doctorOf.get(
              String(b.encounterId ?? b.appointmentId ?? ''),
            ),
            tz: l.timezone,
            itemName: (i) =>
              i.customName ||
              serviceName.get(String(i.serviceCatalogItemId)) ||
              'Service',
          }),
        );
      }
    }
    return out;
  }

  /** A bill the caller may see (bills capability) with its link, or 404. */
  async ownedBill(
    ctx: PortalCtx,
    id: string,
    capability: FamilyCapability = 'bills',
  ) {
    const bill = await this.load(this.billModel, id, 'Bill not found');
    const link = await this.scope.linkFor(
      ctx,
      bill.clinicId,
      bill.patientId,
      capability,
    );
    if (!link || bill.status === BillStatus.Draft)
      throw new NotFoundException('Bill not found');
    return { bill, link };
  }

  async billPdf(ctx: PortalCtx, id: string) {
    const { bill } = await this.ownedBill(ctx, id);
    const docId = await this.billing.ensurePdfGenerated(bill.clinicId, id);
    const doc = await this.documents.getById(
      bill.clinicId,
      docId.toHexString(),
    );
    return this.presign(
      ctx,
      bill.clinicId,
      doc._id,
      doc.storageKey,
      'application/pdf',
    );
  }

  async rxPdf(ctx: PortalCtx, id: string) {
    const rx = await this.load(this.rxModel, id, 'Prescription not found');
    const link = await this.scope.linkFor(ctx, rx.clinicId, rx.patientId, 'rx');
    if (!link) throw new NotFoundException('Prescription not found');
    const visible = (await this.prescriptionsFor(ctx, [link], new Map())).some(
      (p) => p.id === id,
    );
    if (!visible) throw new NotFoundException('Prescription not found');
    const docId = await this.prescriptions.ensurePdfGenerated(rx.clinicId, id);
    const doc = await this.documents.getById(rx.clinicId, docId.toHexString());
    return this.presign(
      ctx,
      rx.clinicId,
      doc._id,
      doc.storageKey,
      'application/pdf',
    );
  }

  // --- Helpers -----------------------------------------------------------------

  private async load<T>(
    model: Model<T>,
    id: string,
    notFound: string,
  ): Promise<any> {
    if (!Types.ObjectId.isValid(id)) throw new NotFoundException(notFound);
    const row = await model.findById(id).lean();
    if (!row) throw new NotFoundException(notFound);
    return row;
  }

  private async presign(
    ctx: PortalCtx,
    clinicId: Types.ObjectId,
    documentId: Types.ObjectId,
    key: string,
    mimeType: string,
  ) {
    touch(ctx, clinicId);
    const url = await this.storage.presignGet({
      key,
      expiresInSeconds: PRESIGN_SECONDS,
    });
    // Per-document access trail, the same one staff downloads write.
    void this.documents
      .recordDownload(clinicId, documentId, {
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      })
      .catch(() => undefined);
    return { url, expiresInSeconds: PRESIGN_SECONDS, mimeType };
  }
}
