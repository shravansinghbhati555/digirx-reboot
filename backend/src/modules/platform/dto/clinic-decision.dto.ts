import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for reject / suspend — the reason is shown back in the queue. */
export class ClinicDecisionDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
