import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PatientAccountGender } from '../../patient-identities/schemas/patient-account.schema';

const PHONE = /^[+\d][\d\s-]{5,19}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(1[0-2]|0?[1-9]):[0-5]\d\s?(AM|PM)$/i;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

// --- Auth -------------------------------------------------------------------

export class RequestOtpDto {
  @IsString()
  @Matches(PHONE, { message: 'Enter a valid mobile number' })
  phone!: string;
}

export class VerifyOtpDto {
  @IsString()
  @Matches(PHONE, { message: 'Enter a valid mobile number' })
  phone!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'The code has 6 digits' })
  code!: string;
}

// --- Profile / privacy -------------------------------------------------------

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @Matches(DATE, { message: 'dob must be YYYY-MM-DD' })
  dob?: string;

  @IsOptional()
  @IsEnum(PatientAccountGender)
  gender?: PatientAccountGender;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: string | null;
}

export class UpdatePrivacyDto {
  @IsOptional()
  @IsBoolean()
  appLock?: boolean;

  @IsOptional()
  @IsBoolean()
  hidePreviews?: boolean;
}

export class ClinicSharingDto {
  @IsBoolean()
  enabled!: boolean;
}

export class MarkReadDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  ids?: string[];
}

// --- Booking ------------------------------------------------------------------

export class BookAppointmentDto {
  /** Who the visit is for: the caller (omitted), a dependant, or a granting adult. */
  @IsOptional()
  @IsMongoId()
  patientId?: string;

  /** Portal clinic id = clinic branch id. */
  @IsMongoId()
  clinicId!: string;

  @IsMongoId()
  doctorId!: string;

  @Matches(DATE, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @Matches(TIME, { message: 'time must look like "10:30 AM"' })
  time!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  shareRecords?: boolean;

  @IsOptional()
  @IsIn(['clinic', 'online'])
  payment?: 'clinic' | 'online';
}

export class CancelAppointmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  reason!: string;
}

export class RescheduleAppointmentDto {
  @Matches(DATE, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @Matches(TIME, { message: 'time must look like "10:30 AM"' })
  time!: string;
}

export class NextAvailableItemDto {
  @IsMongoId()
  clinicId!: string;

  @IsMongoId()
  doctorId!: string;
}

export class NextAvailableDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => NextAvailableItemDto)
  items!: NextAvailableItemDto[];
}

// --- Family -------------------------------------------------------------------

export class AddDependantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName!: string;

  @Matches(DATE, { message: 'dob must be YYYY-MM-DD' })
  dob!: string;

  @IsOptional()
  @IsEnum(PatientAccountGender)
  gender?: PatientAccountGender;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relation?: string;
}

export class InviteFamilyDto {
  @IsString()
  @Matches(PHONE, { message: 'Enter a valid mobile number' })
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  relation?: string;
}

export class RespondInviteDto {
  @IsBoolean()
  accept!: boolean;
}

export class FamilyGrantsDto {
  @IsOptional()
  @IsBoolean()
  book?: boolean;

  @IsOptional()
  @IsBoolean()
  rx?: boolean;

  @IsOptional()
  @IsBoolean()
  reports?: boolean;

  @IsOptional()
  @IsBoolean()
  bills?: boolean;
}

// --- Payments -------------------------------------------------------------------

export class VerifyPortalPaymentDto {
  @IsString()
  @MaxLength(100)
  razorpay_order_id!: string;

  @IsString()
  @MaxLength(100)
  razorpay_payment_id!: string;

  @IsString()
  @MaxLength(200)
  razorpay_signature!: string;
}
