import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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

class RuleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityWindowDto)
  windows!: AvailabilityWindowDto[];

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  slotMinutes?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpsertDoctorRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RuleDto)
  rules!: RuleDto[];
}
