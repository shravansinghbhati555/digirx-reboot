import { IsEnum, IsInt, IsMongoId, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { DocumentAccess, DocumentOwnerType } from '../schemas/document.schema';

export class CreateUploadUrlDto {
  @IsEnum(DocumentOwnerType)
  ownerType!: DocumentOwnerType;

  @IsMongoId()
  ownerId!: string;

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
