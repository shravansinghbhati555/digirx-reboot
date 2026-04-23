import { IsISO8601, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateEncounterDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @IsOptional()
  @IsObject()
  vitals?: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  followUpAt?: string;
}
