import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { OverrideType } from '../schemas/doctor-availability-override.schema';

class AvailabilityWindowDto {
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  startMinutes!: number;

  @IsInt()
  @Min(0)
  @Max(24 * 60)
  endMinutes!: number;
}

export class UpsertDoctorOverrideDto {
  @IsIn(['CLOSED', 'CUSTOM_WINDOWS'])
  type!: OverrideType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  windows?: AvailabilityWindowDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
