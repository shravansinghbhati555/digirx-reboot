import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { PatientIdentifierType } from '../schemas/patient-identifier.schema';

export class CreateIdentifierDto {
  @IsEnum(PatientIdentifierType)
  type!: PatientIdentifierType;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  value!: string;
}
