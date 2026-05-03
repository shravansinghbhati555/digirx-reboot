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

export class CreateBranchDto {
  @IsString()
  @Length(1, 120)
  name!: string;

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
