import { IsNumber, IsOptional } from 'class-validator';

/**
 * Each field must be a number when present, but no clinical min/max —
 * the front desk needs to record whatever the patient presents with,
 * including paediatric extremes and edge readings that any tight bound
 * would falsely reject. Type check stays so the persisted vitals stay
 * coherent (no stray strings sneaking into the schema).
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
