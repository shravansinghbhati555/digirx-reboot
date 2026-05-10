import { IsString, MaxLength, MinLength } from 'class-validator';

export class VoidBillDto {
  /**
   * Required free-text reason. Voids without a reason destroy the audit
   * signal — auditors and operators both need to know why money walked.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
