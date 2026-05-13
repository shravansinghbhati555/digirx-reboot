import { IsEnum, IsISO8601, IsMongoId, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';
import {
  AppointmentSource,
  AppointmentType,
} from '../schemas/appointment.schema';

export class CreateAppointmentDto {
  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @IsMongoId()
  branchId!: string;

  @IsMongoId()
  doctorId!: string;

  @IsMongoId()
  patientId!: string;

  // TIME
  @IsOptional()
  @IsISO8601()
  startAt?: string;

  @IsOptional()
  @IsISO8601()
  endAt?: string;

  // QUEUE (YYYY-MM-DD)
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'queueDate must be YYYY-MM-DD' })
  queueDate?: string;

  @IsOptional()
  @IsEnum(AppointmentSource)
  source?: AppointmentSource;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // Optional per-doctor visit-type. When set, the BE creates an ISSUED
  // bill of the visit-type's price linked to this appointment so the
  // front desk can collect payment before check-in.
  @IsOptional()
  @IsMongoId()
  visitTypeId?: string;

  // Manual fee captured at booking when the doctor has no visit-type
  // catalog. Same effect as visit-type: the BE auto-issues an ISSUED
  // bill with this amount + label so the check-in gate can enforce
  // payment. Ignored if `visitTypeId` is also set (visit-type wins).
  @IsOptional()
  @IsNumber()
  @Min(0)
  manualBillAmount?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  manualBillLabel?: string;
}
