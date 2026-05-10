import { ArrayUnique, IsArray, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  // Permission strings are validated against the Permission enum in the
  // service so an unknown value yields a precise 400 with the offending
  // entry, rather than a generic class-validator message.
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}
