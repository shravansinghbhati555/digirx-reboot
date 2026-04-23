import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EncountersService } from '../encounters/encounters.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { Prescription } from './schemas/prescription.schema';
import { randomBytes } from 'crypto';

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectModel(Prescription.name) private readonly rxModel: Model<Prescription>,
    private readonly encounters: EncountersService,
  ) {}

  async createForEncounter(clinicId: Types.ObjectId, encounterId: string, dto: CreatePrescriptionDto) {
    const enc = await this.encounters.getById(clinicId, encounterId);

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items is required');
    }

    const items = dto.items.map((it) => {
      const hasCatalog = typeof it.medicineCatalogItemId === 'string' && it.medicineCatalogItemId.length > 0;
      const hasCustom = typeof it.customName === 'string' && it.customName.trim().length > 0;
      if (!hasCatalog && !hasCustom) {
        throw new BadRequestException('Each item must have medicineCatalogItemId or customName');
      }

      return {
        medicineCatalogItemId: hasCatalog ? new Types.ObjectId(it.medicineCatalogItemId) : undefined,
        customName: hasCustom ? it.customName!.trim() : undefined,
        dosage: it.dosage?.trim(),
        frequency: it.frequency?.trim(),
        duration: it.duration?.trim(),
        instructions: it.instructions?.trim(),
      };
    });

    return await this.rxModel.create({
      clinicId,
      branchId: enc.branchId,
      doctorId: enc.doctorId,
      patientId: enc.patientId,
      encounterId: enc._id,
      items,
    });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOne({ _id: id, clinicId });
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  async share(clinicId: Types.ObjectId, id: string) {
    const rx = await this.getById(clinicId, id);
    if (!rx.shareToken) {
      rx.shareToken = randomBytes(24).toString('hex');
      await rx.save();
    }
    return { id: rx._id, shareToken: rx.shareToken };
  }

  async getByShareToken(token: string) {
    const rx = await this.rxModel.findOne({ shareToken: token });
    if (!rx) throw new NotFoundException('Invalid token');
    return rx;
  }
}

