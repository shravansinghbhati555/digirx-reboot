import { IsEnum, IsISO8601, IsMongoId, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
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
}
