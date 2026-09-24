import { IsEnum, IsInt, IsMongoId, IsOptional, Max, Min } from 'class-validator';
import { LeaseCounter } from '../schemas/number-lease.schema';

export class IssueLeaseDto {
  @IsEnum(LeaseCounter)
  counter!: LeaseCounter;

  /** Required for BILL, which is counted per branch. Ignored otherwise. */
  @IsOptional()
  @IsMongoId()
  branchId?: string;

  /**
   * Block size. Capped server-side too — every unused number in a block is a
   * permanent gap in the sequence, so a client cannot ask for a huge range.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  size?: number;
}

export class ReportLeaseUsageDto {
  /** Highest number the device has actually used. Never rewinds. */
  @IsInt()
  @Min(0)
  usedThrough!: number;
}
