import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  // bcrypt's hard cap is 72 bytes; we tighten to 128 chars at the DTO level so
  // a misuse fails fast, well before the hash. Min 8 matches OWASP guidance.
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  roleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  branchIds?: string[];

  @IsOptional()
  @IsMongoId()
  defaultBranchId?: string;
}
