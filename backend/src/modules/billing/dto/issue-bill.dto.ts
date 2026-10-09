import { IsInt, IsOptional, Min } from 'class-validator';

/**
 * Body for `POST /bills/:id/issue`.
 *
 * Empty for an ordinary online issue — the server mints the number. A client
 * that issued the bill offline sends the sequence it drew from its BILL
 * lease, so the invoice keeps the number already given to the patient (and
 * already written on a cash receipt).
 */
export class IssueBillDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  billSeq?: number;
}
