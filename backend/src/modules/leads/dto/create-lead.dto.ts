import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Public payload from the marketing site's contact form.
 *
 * Deliberately small and strict: this is an unauthenticated endpoint, and the
 * global ValidationPipe runs with `forbidNonWhitelisted`, so anything else in
 * the body is rejected outright.
 */
export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  @MaxLength(200)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  reason?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
