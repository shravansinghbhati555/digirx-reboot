import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePrescriptionItemDto {
  @IsOptional()
  @IsMongoId()
  medicineCatalogItemId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-zA-Z0-9\s\-./%+(),]*$/, {
    message:
      'Medicine name must not contain special characters except spaces, hyphens, dots, slashes, percentage, plus, parentheses, and commas.',
  })
  customName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dosage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  frequency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  duration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  /** Total units to dispense at the pharmacy (e.g. 10 tablets). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity?: number;
}

export class CreatePrescriptionDto {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  items?: CreatePrescriptionItemDto[];
}
