import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateServiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsNumber()
  @Min(0)
  defaultPrice!: number;
}
