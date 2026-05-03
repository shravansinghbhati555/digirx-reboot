import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

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
}
