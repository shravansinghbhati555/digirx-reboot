import { IsEmail, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsMongoId()
  clinicId!: string;

  @IsOptional()
  @IsMongoId()
  branchId?: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
