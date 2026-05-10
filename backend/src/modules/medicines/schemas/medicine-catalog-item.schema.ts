import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MedicineCatalogItemDocument =
  HydratedDocument<MedicineCatalogItem>;

export enum MedicineForm {
  Tablet = 'TABLET',
  Capsule = 'CAPSULE',
  Syrup = 'SYRUP',
  Injection = 'INJECTION',
  Ointment = 'OINTMENT',
  Drops = 'DROPS',
  Inhaler = 'INHALER',
  Other = 'OTHER',
}

@Schema({ timestamps: true })
export class MedicineCatalogItem {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  genericName?: string;

  @Prop({ trim: true })
  composition?: string;

  @Prop({ type: [String], enum: MedicineForm, default: [] })
  forms!: MedicineForm[];

  /** Free-form strength labels — "500mg", "1g", "200mg/5ml". */
  @Prop({ type: [String], default: [] })
  strengths!: string[];

  @Prop({ type: Boolean, default: true })
  active!: boolean;
}

export const MedicineCatalogItemSchema = SchemaFactory.createForClass(
  MedicineCatalogItem,
);

MedicineCatalogItemSchema.index(
  { clinicId: 1, name: 1 },
  { unique: true, name: 'medicine_unique_name_per_clinic' },
);
// Single text index covers both display name and generic name so the
// search endpoint can fall back to chemical names ("paracetamol" → finds
// "Crocin", "Calpol") without separate queries.
MedicineCatalogItemSchema.index(
  { name: 'text', genericName: 'text', composition: 'text' },
  { name: 'medicine_text_idx', default_language: 'none' },
);
