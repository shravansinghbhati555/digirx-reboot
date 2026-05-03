import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
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

class PatchChannelToggleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

class PatchNotificationsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchChannelToggleDto)
  sms?: PatchChannelToggleDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchChannelToggleDto)
  whatsapp?: PatchChannelToggleDto;
}

class PatchModulesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchInventoryDto)
  inventory?: PatchInventoryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchNotificationsDto)
  notifications?: PatchNotificationsDto;
}

class PatchBrandingDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  displayName?: string | null;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  logoUrl?: string | null;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string | null;
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

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchBrandingDto)
  branding?: PatchBrandingDto;

  // Top-level clinic profile fields. `timezone` is on the Clinic doc itself,
  // not in `settings`, but we expose it here so a single PATCH can update both.
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 8)
  currency?: string;
}
