import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelCreditNoteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}
