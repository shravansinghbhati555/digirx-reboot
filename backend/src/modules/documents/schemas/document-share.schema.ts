import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentShareDocument = HydratedDocument<DocumentShare>;

@Schema({ timestamps: true })
export class DocumentShare {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  documentId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  token!: string;

  @Prop()
  expiresAt?: Date;

  @Prop()
  maxViews?: number;

  @Prop()
  revokedAt?: Date;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const DocumentShareSchema = SchemaFactory.createForClass(DocumentShare);

DocumentShareSchema.index({ token: 1 }, { unique: true, name: 'doc_share_token_unique' });

