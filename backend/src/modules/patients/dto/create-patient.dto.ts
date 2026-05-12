import { ArrayNotEmpty, IsArray, IsEmail, IsEnum, IsISO8601, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PatientGender } from '../schemas/patient.schema';

export class CreatePatientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  fullName!: string;

  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender;

  @IsOptional()
  @IsISO8601()
  dob?: string;

  // Phone is required for new patients — it's the primary lookup key for
  // duplicate detection, SMS reminders, and OTP-based flows. Edits (PATCH)
  // still accept partial bodies via UpdatePatientDto, so a clinician can
  // tweak notes without re-sending phones; the FE keeps it required at
  // the input layer so a phone can't be cleared off an existing record.
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(32, { each: true })
  phones!: string[];

  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  emails?: string[];

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
}
