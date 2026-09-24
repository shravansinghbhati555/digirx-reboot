import { IsISO8601, IsMongoId, IsOptional, IsString, MaxLength } from 'class-validator';
import { ClientIdDto } from '../../offline/dto/client-id.dto';

export class CreateEncounterDto extends ClientIdDto {
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
