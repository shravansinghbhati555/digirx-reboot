import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { NotificationChannel } from '../schemas/notification-template.schema';

export class UpsertTemplateDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
