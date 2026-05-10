import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelAppointmentDto {
  /**
   * Required free-text reason. We force a value so cancellation analytics
   * are usable later — "blank" cancellations destroy the signal.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
