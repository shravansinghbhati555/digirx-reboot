import { IsEmail, IsMongoId, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsMongoId()
  clinicId!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}
