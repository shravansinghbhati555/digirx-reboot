import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateShareDto {
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(60 * 60 * 24 * 365)
  expiresInSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  maxViews?: number;
}
