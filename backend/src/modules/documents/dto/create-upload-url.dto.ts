import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DocumentAccess, DocumentCategory, DocumentOwnerType } from '../schemas/document.schema';

export class CreateUploadUrlDto {
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  @IsMongoId()
  ownerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ownerName?: string;

  @IsOptional()
  @IsEnum(DocumentCategory)
  category?: DocumentCategory;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(255)
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;

  @IsOptional()
  @IsEnum(DocumentAccess)
  access?: DocumentAccess;
}
