import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserStatus } from '../schemas/user.schema';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  branchIds?: string[];

  @IsOptional()
  @IsMongoId()
  defaultBranchId?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
