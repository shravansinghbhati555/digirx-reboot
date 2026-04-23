import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PatchAppointmentsDto {
  @IsOptional()
  @IsIn(['TIME', 'QUEUE', 'BOTH'])
  mode?: 'TIME' | 'QUEUE' | 'BOTH';

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  slotMinutesDefault?: number;
}

class PatchInventoryDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class PatchModulesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchInventoryDto)
  inventory?: PatchInventoryDto;
}

export class PatchClinicSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchAppointmentsDto)
  appointments?: PatchAppointmentsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchModulesDto)
  modules?: PatchModulesDto;
}

