import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PrescriptionCounter,
} from './schemas/prescription-counter.schema';

/**
 * Mints the human-readable prescription number ("RX-000123") that gets
 * printed on the slip and typed back at the pharmacy counter. Mirrors
 * BillNumberingService's atomic-counter pattern.
 *
 * The padded 6-digit width is a balance between "easy to read out loud"
 * and "won't run out for years" — at 100 prescriptions/day a clinic
 * crosses 1,000,000 in 27 years. When that happens the format wraps to
 * 7 digits cleanly without breaking earlier numbers.
 */
@Injectable()
export class PrescriptionNumberingService {
  constructor(
    @InjectModel(PrescriptionCounter.name)
    private readonly counterModel: Model<PrescriptionCounter>,
  ) {}

  async mint(clinicId: Types.ObjectId): Promise<string> {
    // Single atomic upsert — concurrent callers see distinct numbers
    // because Mongo serializes the increment per-document.
    const counter = await this.counterModel.findOneAndUpdate(
      { clinicId },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    );
    const seq = String(counter.lastNumber).padStart(6, '0');
    return `RX-${seq}`;
  }
}
