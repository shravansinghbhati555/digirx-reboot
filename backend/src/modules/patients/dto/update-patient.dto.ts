import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PatientGender } from '../schemas/patient.schema';

export class UpdatePatientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender;

  @IsOptional()
  @IsISO8601()
  dob?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  // See CreatePatientDto — country-agnostic 6–15 digit guard.
  @Matches(/^\d{6,15}$/, { each: true, message: 'Each phone number must be 6 to 15 digits' })
  phones?: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  emails?: string[];

  // ISO 3166-1 alpha-2 (e.g. "IN", "GB") — which country the patient is from.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'countryCode must be a 2-letter ISO code' })
  countryCode?: string;

  @IsOptional()
  @IsMongoId()
  primaryBranchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // Face-recognition opt-in. The FE flips this to `true` during the
  // registration wizard's face step right before POSTing the captured
  // image; the BE refuses the enroll endpoint until this is set.
  // `faceConsentAt` is stamped server-side when consent transitions
  // from falsy → true, so the FE never sends it.
  @IsOptional()
  @IsBoolean()
  faceConsent?: boolean;
}
