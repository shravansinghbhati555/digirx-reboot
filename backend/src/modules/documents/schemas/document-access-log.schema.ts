import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentAccessLogDocument = HydratedDocument<DocumentAccessLog>;

export enum DocumentAccessAction {
  /** Internal user pulled a presigned-GET URL for the document. */
  Download = 'DOWNLOAD',
  /** Public share token was redeemed (anonymous viewer). */
  ShareView = 'SHARE_VIEW',
  /** Operator created a public share token for the document. */
  ShareCreate = 'SHARE_CREATE',
  /** Operator revoked a public share token. */
  ShareRevoke = 'SHARE_REVOKE',
}

/**
 * Per-document trail. The generic AccessLogMiddleware already records every
 * authenticated request, but it indexes by `path` not by `documentId` —
 * unsuitable for compliance reviews that need "who has touched THIS file?".
 *
 * `actorUserId` is null for anonymous public-share views; we still capture
 * IP + user-agent so the reviewer has *something* to triangulate on.
 *
 * `expiresAt` is stamped from the clinic's `logs.retentionDays` setting via
 * RetentionService — same TTL contract as audit + access logs.
 */
@Schema({ timestamps: true })
export class DocumentAccessLog {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  documentId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: DocumentAccessAction, index: true })
  action!: DocumentAccessAction;

  @Prop({ type: Types.ObjectId })
  actorUserId?: Types.ObjectId;

  /** Share-token leaf (last 8 chars) for SHARE_VIEW; helps correlate without storing the full secret. */
  @Prop({ trim: true })
  shareTokenSuffix?: string;

  @Prop({ trim: true })
  ip?: string;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;
}

export const DocumentAccessLogSchema =
  SchemaFactory.createForClass(DocumentAccessLog);

DocumentAccessLogSchema.index(
  { clinicId: 1, documentId: 1, createdAt: -1 },
  { name: 'doc_access_log_per_doc_idx' },
);
DocumentAccessLogSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, name: 'doc_access_log_ttl_idx' },
);
