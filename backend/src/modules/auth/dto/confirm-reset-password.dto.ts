import { IsEmail, IsMongoId, IsString, MaxLength, MinLength } from 'class-validator';

export class ConfirmResetPasswordDto {
  @IsMongoId()
  clinicId!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
