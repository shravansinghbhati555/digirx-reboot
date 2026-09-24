import { NotificationChannel } from '../schemas/notification-template.schema';

export type SendNotificationInput = {
  channel: NotificationChannel;
  to: string;
  body: string;
  /**
   * Email-only overrides, ignored by SMS and WhatsApp.
   *
   * Appointment reminders leave both unset: their `body` is one string reused
   * across all three channels, so the subject and HTML part are derived from
   * it (see `email-format.ts`). Email-only mail that has a designed template —
   * the clinic lifecycle mails in `emails/` — passes them instead, so the
   * subject is written rather than guessed from the first line, and the HTML
   * part is the branded layout rather than a <br/>-joined body.
   */
  subject?: string;
  html?: string;
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
