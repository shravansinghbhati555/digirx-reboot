import { DocumentAccess, DocumentOwnerType } from '../schemas/document.schema';

export class CreateUploadUrlDto {
  ownerType!: DocumentOwnerType;
  ownerId!: string;
  fileName!: string;
  mimeType!: string;
  sizeBytes!: number;
  access?: DocumentAccess;
}
