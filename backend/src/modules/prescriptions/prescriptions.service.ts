import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import { EncountersService } from '../encounters/encounters.service';
import { MedicinesService } from '../medicines/medicines.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel } from '../notifications/schemas/notification-template.schema';
import { renderTemplate } from '../notifications/template.utils';
import { Patient } from '../patients/schemas/patient.schema';
import { User } from '../authz/schemas/user.schema';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import {
  Prescription,
  type PrescriptionDocument,
} from './schemas/prescription.schema';

const DEFAULT_RX_SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

const FALLBACK_RX_TEMPLATE =
  'Hi {{patientName}}, your prescription from Dr. {{doctorName}} at {{clinicName}} is here: {{url}}';

export type ShareResult = {
  id: Types.ObjectId;
  shareToken: string;
  shareTokenExpiresAt: Date | null;
  url: string;
  notificationLogId?: string;
};

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectModel(Prescription.name)
    private readonly rxModel: Model<Prescription>,
    @InjectModel(Patient.name) private readonly patientModel: Model<Patient>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    private readonly encounters: EncountersService,
    private readonly medicines: MedicinesService,
    private readonly notifications: NotificationsService,
  ) { }

  /**
   * Get the prescription for an encounter, or null if none exists yet.
   */
  async getByEncounter(
    clinicId: Types.ObjectId,
    encounterId: string,
  ): Promise<Prescription | null> {
    return this.rxModel
      .findOne({ clinicId, encounterId: new Types.ObjectId(encounterId) })
      .exec();
  }

  /**
   * Upsert prescription items for an encounter.
   * If no prescription exists yet, creates one.
   * If one already exists, replaces its items.
   * Safe to call at any time (draft or signed).
   */
  async upsertForEncounter(
    clinicId: Types.ObjectId,
    encounterId: string,
    dto: CreatePrescriptionDto,
  ) {
    const enc = await this.encounters.getById(clinicId, encounterId);
    const items = await this.mapItems(clinicId, dto);

    const existing = await this.rxModel
      .findOne({ clinicId, encounterId: enc._id })
      .exec();

    if (existing) {
      existing.items = items as any;
      return existing.save();
    }

    return await this.rxModel.create({
      clinicId,
      branchId: enc.branchId,
      doctorId: enc.doctorId,
      patientId: enc.patientId,
      encounterId: enc._id,
      items,
    });
  }

  async createForEncounter(
    clinicId: Types.ObjectId,
    encounterId: string,
    dto: CreatePrescriptionDto,
  ) {
    // Delegate to upsert — idempotent, no duplicates
    return this.upsertForEncounter(clinicId, encounterId, dto);
  }

  async findByEncounter(clinicId: Types.ObjectId, encounterId: string) {
    return await this.rxModel
      .find({
        clinicId,
        encounterId: new Types.ObjectId(encounterId),
      })
      .exec();
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOne({ _id: id, clinicId }).exec();
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  /**
   * Create or rotate the share token for a prescription. Optionally pushes
   * the resulting URL out via SMS/WhatsApp using the existing notifications
   * pipeline — caller passes `sendVia`.
   *
   * `expiresInSeconds`:
   *   - omitted → DEFAULT_RX_SHARE_EXPIRY_SECONDS (7 days)
   *   - positive number → that many seconds from now
   *   - `null` → no expiry; valid until explicitly revoked
   */
  async share(
    clinicId: Types.ObjectId,
    id: string,
    opts: {
      expiresInSeconds?: number | null;
      sendVia?: NotificationChannel;
      to?: string;
    } = {},
  ): Promise<ShareResult> {
    const rx = await this.rxModel.findOne({ _id: id, clinicId }).exec();
    if (!rx) throw new NotFoundException('Prescription not found');

    let expiresAt: Date | undefined;
    if (opts.expiresInSeconds === null) {
      expiresAt = undefined;
    } else if (
      typeof opts.expiresInSeconds === 'number' &&
      Number.isFinite(opts.expiresInSeconds) &&
      opts.expiresInSeconds > 0
    ) {
      expiresAt = new Date(Date.now() + opts.expiresInSeconds * 1000);
    } else {
      expiresAt = new Date(Date.now() + DEFAULT_RX_SHARE_EXPIRY_SECONDS * 1000);
    }

    rx.shareToken = randomBytes(24).toString('hex');
    rx.shareTokenExpiresAt = expiresAt;
    rx.shareTokenRevokedAt = undefined;
    await rx.save();

    const url = buildShareUrl(rx.shareToken);

    const result: ShareResult = {
      id: rx._id,
      shareToken: rx.shareToken,
      shareTokenExpiresAt: rx.shareTokenExpiresAt ?? null,
      url,
    };

    if (opts.sendVia) {
      const log = await this.dispatchShareNotification({
        rx,
        clinicId,
        url,
        channel: opts.sendVia,
        toOverride: opts.to,
      });
      if (log) result.notificationLogId = String(log._id);
    }

    return result;
  }

  async getByShareToken(token: string) {
    const rx = await this.rxModel.findOne({ shareToken: token }).exec();
    if (!rx) throw new NotFoundException('Invalid token');
    if (rx.shareTokenRevokedAt) throw new NotFoundException('Invalid token');
    if (
      rx.shareTokenExpiresAt &&
      rx.shareTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException('Invalid token');
    }
    return rx;
  }

  async revokeShare(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOneAndUpdate(
      {
        _id: id,
        clinicId,
        shareToken: { $ne: null },
        shareTokenRevokedAt: null,
      },
      { $set: { shareTokenRevokedAt: new Date() } },
      { new: true },
    );
    if (!rx) throw new NotFoundException('Active share not found');
    return rx;
  }

  private async mapItems(clinicId: Types.ObjectId, dto: CreatePrescriptionDto) {
    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items is required');
    }
    return await Promise.all(
      dto.items.map(async (it) => {
        const hasCatalog =
          typeof it.medicineCatalogItemId === 'string' &&
          it.medicineCatalogItemId.length > 0;
        const hasCustom =
          typeof it.customName === 'string' &&
          it.customName.trim().length > 0;
        if (!hasCatalog && !hasCustom) {
          throw new BadRequestException(
            'Each item must have medicineCatalogItemId or customName',
          );
        }

        let medicineCatalogItemId: Types.ObjectId | undefined;
        if (hasCatalog) {
          medicineCatalogItemId = new Types.ObjectId(
            it.medicineCatalogItemId,
          );
          // Cross-tenant safety: confirm the catalog item belongs to this
          // clinic before storing the reference.
          await this.medicines.assertExists(clinicId, medicineCatalogItemId);
        }

        return {
          medicineCatalogItemId,
          customName: hasCustom ? it.customName!.trim() : undefined,
          dosage: it.dosage?.trim(),
          frequency: it.frequency?.trim(),
          duration: it.duration?.trim(),
          instructions: it.instructions?.trim(),
        };
      }),
    );
  }

  private async dispatchShareNotification(input: {
    rx: PrescriptionDocument;
    clinicId: Types.ObjectId;
    url: string;
    channel: NotificationChannel;
    toOverride?: string;
  }) {
    const [patient, doctor, clinic] = await Promise.all([
      this.patientModel.findOne({
        _id: input.rx.patientId,
        clinicId: input.clinicId,
      }),
      this.userModel.findOne({
        _id: input.rx.doctorId,
        clinicId: input.clinicId,
      }),
      this.clinicModel.findById(input.clinicId),
    ]);

    const phone =
      input.toOverride?.trim() ||
      (patient?.phones ?? []).find((p) => String(p).trim()) ||
      undefined;
    if (!phone) {
      throw new BadRequestException(
        "Cannot send: patient has no phone on file and no `to` override was provided",
      );
    }

    const body = renderTemplate(FALLBACK_RX_TEMPLATE, {
      patientName: patient?.fullName ?? 'there',
      doctorName: doctor?.name ?? 'your doctor',
      clinicName: clinic?.name ?? 'the clinic',
      url: input.url,
    });

    return await this.notifications.enqueueSend({
      clinicId: input.clinicId,
      branchId: input.rx.branchId,
      channel: input.channel,
      to: phone,
      body,
      // dedupeKey scoped to (rx, channel) so a retry doesn't double-send.
      // Each share() call rotates the token (and therefore the URL), so a
      // fresh share with sendVia produces a fresh dedupeKey.
      dedupeKey: `rx:${input.rx._id.toHexString()}:share:${input.rx.shareToken}:${input.channel}`,
      templateKey: 'prescription_share',
    });
  }
}

function buildShareUrl(token: string): string {
  const base = (
    process.env.FRONTEND_ORIGIN ||
    process.env.PUBLIC_BASE_URL ||
    'http://localhost:5173'
  ).replace(/\/+$/, '');
  return `${base}/share/prescriptions/${token}`;
}
