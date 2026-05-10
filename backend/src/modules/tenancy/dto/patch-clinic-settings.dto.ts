import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
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

// HH:MM 24-hour. `null` = clear that side of the window. Both null = quiet
// hours disabled. Mirroring the QuietHours type in clinic-settings.types.ts.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class PatchQuietHoursDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(HHMM, { message: 'start must be HH:MM (24-hour) or null' })
  start?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(HHMM, { message: 'end must be HH:MM (24-hour) or null' })
  end?: string | null;
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

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchQuietHoursDto)
  quietHours?: PatchQuietHoursDto;
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
