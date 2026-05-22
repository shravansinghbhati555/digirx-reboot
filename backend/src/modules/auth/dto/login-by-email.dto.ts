import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Email-only login. The BE resolves clinicId + branchId from the
 * matched user's profile (User.clinicId is required; defaultBranchId
 * is required for non-admin roles via FE validation in the Add User
 * form). Used by the single-step LoginScreen flow.
 */
export class LoginByEmailDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
