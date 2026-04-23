import { IsEnum, IsString, MaxLength, MinLength } from 'class-validator';
import { NotificationChannel } from '../schemas/notification-template.schema';

export class TestNotificationDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1600)
  body!: string;
}
