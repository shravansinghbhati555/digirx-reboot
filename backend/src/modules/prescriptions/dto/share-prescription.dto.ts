import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { NotificationChannel } from '../../notifications/schemas/notification-template.schema';

export class SharePrescriptionDto {
  /**
   * Seconds until the share link expires.
   *   - omit → 7-day default
   *   - explicit `null` → no expiry; valid until revoked
   *   - positive integer → that many seconds (capped at 1 year)
   */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsInt()
  @Min(60)
  @Max(60 * 60 * 24 * 365)
  expiresInSeconds?: number | null;

  /**
   * When set, the service also enqueues a NotificationLog so the share URL
   * goes out via SMS or WhatsApp using the existing notifications pipeline.
   * Leave omitted to get just the token + URL back (caller-driven delivery).
   */
  @IsOptional()
  @IsEnum(NotificationChannel)
  sendVia?: NotificationChannel;

  /**
   * Override which phone the message goes to. Defaults to the patient's
   * first phone on file. Useful when a relative is collecting the script.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
}
