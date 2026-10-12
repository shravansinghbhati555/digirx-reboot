import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Shape of the code the client mints: four groups of four base32 chars. */
export const RECOVERY_CODE_RE = /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/;

export class RegisterDeviceRecoveryDto {
  @IsString()
  @Matches(RECOVERY_CODE_RE, { message: 'recoveryCode must look like XXXX-XXXX-XXXX-XXXX' })
  recoveryCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;
}
