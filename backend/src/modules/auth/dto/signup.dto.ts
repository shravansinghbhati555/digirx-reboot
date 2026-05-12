import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  clinicName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  branchName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+\d{1,4}$/)
  phoneCountryCode?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  adminName!: string;

  @IsEmail()
  @MaxLength(254)
  adminEmail!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
