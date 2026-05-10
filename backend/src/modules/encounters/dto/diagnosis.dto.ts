import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DiagnosisItemDto {
  /**
   * ICD-10 code. Format is validated softly — a regex would block legitimate
   * regional variants, so we just cap length and require non-empty when
   * present. Operators looking for billing-grade enforcement should layer
   * their own validator.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  code?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsBoolean()
  primary!: boolean;
}
