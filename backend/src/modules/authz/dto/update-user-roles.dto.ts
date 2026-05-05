import { ArrayUnique, IsArray, IsMongoId } from 'class-validator';

export class UpdateUserRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  roleIds!: string[];
}
