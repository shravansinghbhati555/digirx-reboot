import { IsNumber, IsOptional } from 'class-validator';

/**
 * Validation bounds removed as per user request to allow maximum flexibility 
 * during triage and clinical data entry.
 */
export class VitalsDto {
  @IsOptional()
  @IsNumber()
  heightCm?: number;

  @IsOptional()
  @IsNumber()
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  temperatureC?: number;

  @IsOptional()
  @IsNumber()
  pulseBpm?: number;

  @IsOptional()
  @IsNumber()
  bpSystolic?: number;

  @IsOptional()
  @IsNumber()
  bpDiastolic?: number;

  @IsOptional()
  @IsNumber()
  spo2?: number;

  @IsOptional()
  @IsNumber()
  respiratoryRate?: number;
}
