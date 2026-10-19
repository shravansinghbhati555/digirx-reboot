import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RecordAccessGrant,
  RecordAccessSource,
  RecordAccessStatus,
} from './schemas/record-access-grant.schema';
import { PatientIdentitiesService } from '../patient-identities/patient-identities.service';
import { PatientsService } from '../patients/patients.service';
import { AccessLogsService } from '../access-logs/access-logs.service';
import { Patient } from '../patients/schemas/patient.schema';
import { Prescription } from '../prescriptions/schemas/prescription.schema';
import { EncounterStatus } from '../encounters/schemas/encounter.schema';
import { MedicineCatalogItem } from '../medicines/schemas/medicine-catalog-item.schema';

export type SharedVisit = {
  clinicName: string;
  branchName: string | null;
  doctorName: string | null;
  visitedAt: Date;
  chiefComplaint?: string;
  diagnoses: string[];
  medicines: string[];
  followUpAt?: Date;
};

@Injectable()
export class RecordAccessService {
  private readonly logger = new Logger(RecordAccessService.name);

  constructor(
    @InjectModel(RecordAccessGrant.name)
    private readonly grantModel: Model<RecordAccessGrant>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(Prescription.name)
    private readonly rxModel: Model<Prescription>,
    @InjectModel(MedicineCatalogItem.name)
    private readonly medModel: Model<MedicineCatalogItem>,
    private readonly identities: PatientIdentitiesService,
    private readonly patients: PatientsService,
    private readonly accessLogs: AccessLogsService,
  ) {}

  private activeFilter(accountId: Types.ObjectId, clinicId?: Types.ObjectId) {
    return {
      accountId,
      ...(clinicId ? { granteeClinicId: clinicId } : {}),
      status: RecordAccessStatus.Active,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    };
  }

  /** Clinics this account currently shares its other records with. */
  async listActive(accountId: Types.ObjectId) {
    return this.grantModel.find(this.activeFilter(accountId)).lean();
  }

  async hasAccess(
    accountId: Types.ObjectId,
    clinicId: Types.ObjectId,
  ): Promise<boolean> {
    return !!(await this.grantModel.exists(
      this.activeFilter(accountId, clinicId),
    ));
  }

  /**
   * Turn sharing with a clinic on or off. Turning it on never shortens an
   * existing grant; turning it off revokes every grant for that clinic.
   */
  async set(input: {
    accountId: Types.ObjectId;
    clinicId: Types.ObjectId;
    enabled: boolean;
    source: RecordAccessSource;
    expiresAt?: Date;
  }): Promise<void> {
    const now = new Date();
    if (!input.enabled) {
      await this.grantModel.updateMany(
        {
          accountId: input.accountId,
          granteeClinicId: input.clinicId,
          status: RecordAccessStatus.Active,
        },
        { $set: { status: RecordAccessStatus.Revoked, revokedAt: now } },
      );
      return;
    }
    const current = await this.grantModel
      .find(this.activeFilter(input.accountId, input.clinicId))
      .lean();
    const covers = current.some(
      (g) =>
        !g.expiresAt || (input.expiresAt && g.expiresAt >= input.expiresAt),
    );
    if (covers) return;
    await this.grantModel.create({
      accountId: input.accountId,
      granteeClinicId: input.clinicId,
      status: RecordAccessStatus.Active,
      source: input.source,
      expiresAt: input.expiresAt,
    });
  }

  /**
   * For clinic staff: this patient's signed visits at OTHER DigiRx clinics,
   * returned only when the patient has shared them with the requesting
   * clinic. Each source clinic gets an access-log row naming who read them.
   */
  async sharedRecordsForClinic(
    clinicId: Types.ObjectId,
    patientId: string,
    actorUserId?: Types.ObjectId,
  ): Promise<{ shared: boolean; visits: SharedVisit[] }> {
    if (!Types.ObjectId.isValid(patientId))
      throw new NotFoundException('Patient not found');
    const pid = new Types.ObjectId(patientId);
    const exists = await this.patientModel.exists({ _id: pid, clinicId });
    if (!exists) throw new NotFoundException('Patient not found');

    const accountId = await this.identities.accountForPatient(clinicId, pid);
    if (!accountId || !(await this.hasAccess(accountId, clinicId))) {
      return { shared: false, visits: [] };
    }

    const links = (await this.identities.visibleLinks(accountId)).filter(
      (l) => !l.clinicId.equals(clinicId),
    );
    const visits: SharedVisit[] = [];
    for (const link of links) {
      const history = await this.patients.getHistory(
        link.clinicId,
        link.patientId.toHexString(),
      );
      const signed = history.encounters.filter(
        (e: any) => e.status === EncounterStatus.Signed,
      );
      const rx = signed.length
        ? await this.rxModel
            .find({
              clinicId: link.clinicId,
              encounterId: { $in: signed.map((e: any) => e._id) },
            })
            .select({ encounterId: 1, items: 1 })
            .lean()
        : [];
      const catalogIds = rx.flatMap((r) =>
        (r.items ?? [])
          .map((i: any) => i.medicineCatalogItemId)
          .filter(Boolean),
      );
      const catalog = catalogIds.length
        ? await this.medModel
            .find({ _id: { $in: catalogIds }, clinicId: link.clinicId })
            .select({ name: 1 })
            .lean()
        : [];
      const catalogName = new Map(catalog.map((m) => [String(m._id), m.name]));
      const medsByEnc = new Map<string, string[]>();
      for (const r of rx) {
        const names = (r.items ?? [])
          .map(
            (i: any) =>
              i.customName || catalogName.get(String(i.medicineCatalogItemId)),
          )
          .filter(Boolean) as string[];
        medsByEnc.set(String(r.encounterId), [
          ...(medsByEnc.get(String(r.encounterId)) ?? []),
          ...names,
        ]);
      }
      for (const e of signed as any[]) {
        visits.push({
          clinicName: link.clinicName,
          branchName: e.branchName ?? null,
          doctorName: e.doctorName ?? null,
          visitedAt: e.visitedAt,
          chiefComplaint: e.chiefComplaint,
          diagnoses: (e.diagnoses ?? [])
            .map((d: any) => d.description || d.code)
            .filter(Boolean),
          medicines: medsByEnc.get(String(e._id)) ?? [],
          followUpAt: e.followUpAt,
        });
      }
      void this.accessLogs
        .write({
          clinicId: link.clinicId,
          actorUserId: undefined,
          method: 'GET',
          path: `/record-access/shared-with/${clinicId.toHexString()}${actorUserId ? `/by/${actorUserId.toHexString()}` : ''}`,
          statusCode: 200,
          durationMs: 0,
        } as any)
        .catch((err) =>
          this.logger.warn(`access log failed: ${err?.message ?? err}`),
        );
    }
    visits.sort(
      (a, b) =>
        new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime(),
    );
    return { shared: true, visits };
  }
}
