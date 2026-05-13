import { IsArray, IsEmail, IsEnum, IsISO8601, IsMongoId, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^\d{10}$/, { each: true, message: 'Each phone number must be exactly 10 digits' })
  phones?: string[];

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
