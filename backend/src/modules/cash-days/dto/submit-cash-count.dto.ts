import { IsMongoId, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { ClientIdDto } from '../../offline/dto/client-id.dto';

/**
 * The collector's count of the drawer. Extends `ClientIdDto` because it is
 * entered at day end on a tablet that may well be offline.
 */
export class SubmitCashCountDto extends ClientIdDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  /** Defaults to the request's branch. */
  @IsOptional()
  @IsMongoId()
  branchId?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedCash!: number;

  /** What the counting device expected — cash it knows was collected. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  expectedCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ApproveCashDayDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
