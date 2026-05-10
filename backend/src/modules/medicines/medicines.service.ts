import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { MedicineCatalogItem } from './schemas/medicine-catalog-item.schema';

@Injectable()
export class MedicinesService {
  constructor(
    @InjectModel(MedicineCatalogItem.name)
    private readonly medModel: Model<MedicineCatalogItem>,
  ) {}

  async create(clinicId: Types.ObjectId, dto: CreateMedicineDto) {
    try {
      return await this.medModel.create({
        clinicId,
        name: dto.name.trim(),
        genericName: dto.genericName?.trim(),
        composition: dto.composition?.trim(),
        forms: dto.forms ?? [],
        strengths: (dto.strengths ?? []).map((s) => s.trim()).filter(Boolean),
        active: dto.active ?? true,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `A medicine named '${dto.name.trim()}' already exists in this clinic`,
        );
      }
      throw err;
    }
  }

  async update(clinicId: Types.ObjectId, id: string, dto: UpdateMedicineDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Medicine not found');
    }
    const med = await this.medModel.findOne({ _id: id, clinicId });
    if (!med) throw new NotFoundException('Medicine not found');

    if (dto.name !== undefined) med.name = dto.name.trim();
    if (dto.genericName !== undefined) {
      med.genericName = dto.genericName.trim() || undefined;
    }
    if (dto.composition !== undefined) {
      med.composition = dto.composition.trim() || undefined;
    }
    if (dto.forms !== undefined) med.forms = dto.forms;
    if (dto.strengths !== undefined) {
      med.strengths = dto.strengths.map((s) => s.trim()).filter(Boolean);
    }
    if (dto.active !== undefined) med.active = dto.active;

    try {
      await med.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `A medicine named '${med.name}' already exists in this clinic`,
        );
      }
      throw err;
    }
    return med;
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Medicine not found');
    }
    const med = await this.medModel.findOne({ _id: id, clinicId });
    if (!med) throw new NotFoundException('Medicine not found');
    return med;
  }

  async search(
    clinicId: Types.ObjectId,
    input: { query?: string; activeOnly?: boolean; limit?: number },
  ) {
    const limit = Math.max(1, Math.min(100, input.limit ?? 25));
    const filter: Record<string, unknown> = { clinicId };
    if (input.activeOnly) filter.active = true;

    const q = (input.query ?? '').trim();
    if (q) {
      // Try the text index first; fall through to a regex prefix match if the
      // full-text query returns nothing (text index requires whole-word
      // tokens, which fails for 2-3 character autocomplete prefixes).
      const textHits = await this.medModel
        .find(
          { ...filter, $text: { $search: q } },
          { score: { $meta: 'textScore' } },
        )
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit);
      if (textHits.length) return textHits;

      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return await this.medModel
        .find({
          ...filter,
          $or: [
            { name: { $regex: escaped, $options: 'i' } },
            { genericName: { $regex: escaped, $options: 'i' } },
          ],
        })
        .sort({ name: 1 })
        .limit(limit);
    }

    return await this.medModel.find(filter).sort({ name: 1 }).limit(limit);
  }

  async remove(clinicId: Types.ObjectId, id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Medicine not found');
    }
    const result = await this.medModel.findOneAndDelete({ _id: id, clinicId });
    if (!result) throw new NotFoundException('Medicine not found');
    return { ok: true as const };
  }

  /** Used by the prescription service to validate cross-references. */
  async assertExists(clinicId: Types.ObjectId, id: Types.ObjectId) {
    const exists = await this.medModel.exists({ _id: id, clinicId });
    if (!exists) {
      throw new BadRequestException(
        `medicineCatalogItemId ${id.toHexString()} does not belong to this clinic`,
      );
    }
  }
}
