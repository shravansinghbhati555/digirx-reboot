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
import { ClientIdDto } from '../../offline/dto/client-id.dto';

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

export class CreatePrescriptionDto extends ClientIdDto {
  /**
   * Sequence drawn from this device's PRESCRIPTION lease while offline.
   * Only the raw number crosses the wire; the server renders the final
   * `prescriptionNo` from it after proving the sequence was leased to this
   * device, so a printed slip keeps the number the doctor saw.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  prescriptionSeq?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreatePrescriptionItemDto)
  items?: CreatePrescriptionItemDto[];
}
