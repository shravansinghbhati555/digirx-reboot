import { IsISO8601, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateEncounterDto {
  @IsMongoId()
  branchId!: string;

  @IsMongoId()
  doctorId!: string;

  @IsMongoId()
  patientId!: string;

  @IsOptional()
  @IsMongoId()
  appointmentId?: string;

  @IsOptional()
  @IsISO8601()
  visitedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;
}
