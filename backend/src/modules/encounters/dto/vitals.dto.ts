import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/**
 * Bounds chosen wide enough for clinical edge cases (paediatrics through
 * geriatrics) but tight enough to catch obvious data-entry errors — e.g.,
 * a 250-bpm pulse or a 50°C body temperature.
 */
export class VitalsDto {
  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(260)
  heightCm?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(400)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(25)
  @Max(45)
  temperatureC?: number;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(250)
  pulseBpm?: number;

  @IsOptional()
  @IsNumber()
  @Min(40)
  @Max(260)
  bpSystolic?: number;

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(200)
  bpDiastolic?: number;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(100)
  spo2?: number;

  @IsOptional()
  @IsNumber()
  @Min(5)
  @Max(80)
  respiratoryRate?: number;
}
