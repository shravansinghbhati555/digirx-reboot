import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const BRANCH_CODE_RE = /^[A-Za-z0-9]{1,8}$/;

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(BRANCH_CODE_RE, {
    message: 'code must be 1-8 alphanumeric characters',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @Length(0, 32)
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'open must be HH:MM (24h)' })
  open?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'close must be HH:MM (24h)' })
  close?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  slotsPerDay?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
