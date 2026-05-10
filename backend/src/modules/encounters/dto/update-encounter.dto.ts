import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiagnosisItemDto } from './diagnosis.dto';
import { VitalsDto } from './vitals.dto';

export class UpdateEncounterDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  /**
   * Free-text legacy diagnosis. New clients should send `diagnoses` instead;
   * the field is preserved so older UIs keep working.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => DiagnosisItemDto)
  diagnoses?: DiagnosisItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;

  @IsOptional()
  @IsISO8601()
  followUpAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  followUpNotes?: string;
}
