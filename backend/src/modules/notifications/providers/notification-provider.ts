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

// DI token used by NotificationsProcessor to receive whichever provider the
// module factory selects based on the NOTIFICATION_PROVIDER env var.
export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';
