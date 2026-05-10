import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EncountersService } from '../encounters/encounters.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { Prescription } from './schemas/prescription.schema';
import { randomBytes } from 'crypto';

const DEFAULT_RX_SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

/** Shared logic for mapping DTO items → stored items */
function mapItems(dto: CreatePrescriptionDto) {
  if (!Array.isArray(dto.items) || dto.items.length === 0) {
    throw new BadRequestException('items is required');
  }
  return dto.items.map((it) => {
    const hasCatalog =
      typeof it.medicineCatalogItemId === 'string' &&
      it.medicineCatalogItemId.length > 0;
    const hasCustom =
      typeof it.customName === 'string' && it.customName.trim().length > 0;
    if (!hasCatalog && !hasCustom) {
      throw new BadRequestException(
        'Each item must have medicineCatalogItemId or customName',
      );
    }
    return {
      medicineCatalogItemId: hasCatalog
        ? new Types.ObjectId(it.medicineCatalogItemId)
        : undefined,
      customName: hasCustom ? it.customName!.trim() : undefined,
      dosage: it.dosage?.trim(),
      frequency: it.frequency?.trim(),
      duration: it.duration?.trim(),
      instructions: it.instructions?.trim(),
    };
  });
}

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectModel(Prescription.name)
    private readonly rxModel: Model<Prescription>,
    private readonly encounters: EncountersService,
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
    console.time("checkingtime")
    const enc = await this.encounters.getById(clinicId, encounterId);
    const items = mapItems(dto);

    const existing = await this.rxModel
      .findOne({ clinicId, encounterId: enc._id })
      .exec();

    if (existing) {
      existing.items = items as any;
      return existing.save();
    }
    console.timeEnd("checkingtime")
    return this.rxModel.create({
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

  async getById(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOne({ _id: id, clinicId }).exec();
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  /**
   * Create or rotate the share token for a prescription.
   *
   * `expiresInSeconds`:
   *   - omitted → DEFAULT_RX_SHARE_EXPIRY_SECONDS (7 days)
   *   - positive number → that many seconds from now
   *   - `null` → no expiry; valid until explicitly revoked
   */
  async share(
    clinicId: Types.ObjectId,
    id: string,
    expiresInSeconds?: number | null,
  ) {
    const rx = await this.rxModel.findOne({ _id: id, clinicId }).exec();
    if (!rx) throw new NotFoundException('Prescription not found');

    let expiresAt: Date | undefined;
    if (expiresInSeconds === null) {
      expiresAt = undefined;
    } else if (
      typeof expiresInSeconds === 'number' &&
      Number.isFinite(expiresInSeconds) &&
      expiresInSeconds > 0
    ) {
      expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    } else {
      expiresAt = new Date(Date.now() + DEFAULT_RX_SHARE_EXPIRY_SECONDS * 1000);
    }

    rx.shareToken = randomBytes(24).toString('hex');
    rx.shareTokenExpiresAt = expiresAt;
    rx.shareTokenRevokedAt = undefined;
    await rx.save();

    return {
      id: rx._id,
      shareToken: rx.shareToken,
      shareTokenExpiresAt: rx.shareTokenExpiresAt ?? null,
    };
  }

  async getByShareToken(token: string) {
    const rx = await this.rxModel.findOne({ shareToken: token }).exec();
    if (!rx) throw new NotFoundException('Invalid token');
    if (rx.shareTokenRevokedAt) throw new NotFoundException('Invalid token');
    // No expiry set ⇒ valid until explicit revoke.
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
      { _id: id, clinicId, shareToken: { $ne: null }, shareTokenRevokedAt: null },
      { $set: { shareTokenRevokedAt: new Date() } },
      { new: true },
    );
    if (!rx) throw new NotFoundException('Active share not found');
    return rx;
  }
}
