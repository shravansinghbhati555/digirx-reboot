import { NotificationChannel } from '../schemas/notification-template.schema';

export type SendNotificationInput = {
  channel: NotificationChannel;
  to: string;
  body: string;
};

export type SendNotificationResult = {
  providerMessageId?: string;
  providerResponse?: Record<string, unknown>;
};

export interface NotificationProvider {
  send(input: SendNotificationInput): Promise<SendNotificationResult>;
}
