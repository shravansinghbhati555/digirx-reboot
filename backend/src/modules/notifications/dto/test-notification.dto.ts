import { NotificationChannel } from '../schemas/notification-template.schema';

export class TestNotificationDto {
  channel!: NotificationChannel;
  to!: string;
  body!: string;
}

