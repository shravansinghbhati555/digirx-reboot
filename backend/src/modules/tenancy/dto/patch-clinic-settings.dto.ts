import {
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PatchAppointmentsDto {
  @IsOptional()
  @IsIn(['TIME', 'QUEUE', 'BOTH'])
  mode?: 'TIME' | 'QUEUE' | 'BOTH';

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(180)
  slotMinutesDefault?: number;
}

export class PatchInventoryDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class PatchChannelToggleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

// HH:MM 24-hour. `null` = clear that side of the window. Both null = quiet
// hours disabled. Mirroring the QuietHours type in clinic-settings.types.ts.
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PatchQuietHoursDto {
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

export class PatchNotificationsDto {
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

export class PatchFaceRecognitionDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class PatchModulesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => PatchInventoryDto)
  inventory?: PatchInventoryDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchNotificationsDto)
  notifications?: PatchNotificationsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PatchFaceRecognitionDto)
  faceRecognition?: PatchFaceRecognitionDto;
}

export class PatchBrandingDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  displayName?: string | null;

  // Either a full http(s) URL (legacy) OR an internal S3 object key
  // produced by POST /clinics/:id/logo. The dedicated upload endpoint
  // is the normal path for setting this; this field stays here so
  // a PATCH that round-trips the existing value doesn't fail.
  @IsOptional()
  @Matches(/^(https?:\/\/.+|clinics\/[0-9a-fA-F]{24}\/logo)$/, {
    message: 'logoUrl must be a URL address or an uploaded-logo key',
  })
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
