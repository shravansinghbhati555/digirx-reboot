import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ServiceCatalogItemDocument = HydratedDocument<ServiceCatalogItem>;

@Schema({ timestamps: true })
export class ServiceCatalogItem {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, min: 0 })
  defaultPrice!: number;

  @Prop({ trim: true })
  taxCode?: string;

  @Prop({ default: true })
  active!: boolean;
}

export const ServiceCatalogItemSchema =
  SchemaFactory.createForClass(ServiceCatalogItem);

ServiceCatalogItemSchema.index(
  { clinicId: 1, name: 1 },
  { unique: true, name: 'service_catalog_unique_name_per_clinic' },
);
// Full-text index for service-name search (CreateBillSheet typeahead).
// `default_language: 'none'` skips stemming so "X-ray" / "MRI Brain" /
// "ECG-Stress" all tokenise predictably.
ServiceCatalogItemSchema.index(
  { name: 'text' },
  { name: 'service_catalog_text_idx', default_language: 'none' },
);
