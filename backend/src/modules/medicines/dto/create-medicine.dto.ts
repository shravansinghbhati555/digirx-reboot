import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { MedicineForm } from '../schemas/medicine-catalog-item.schema';

export class CreateMedicineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  composition?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(8)
  @IsEnum(MedicineForm, { each: true })
  forms?: MedicineForm[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  strengths?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
