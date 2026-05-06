import { Injectable, Logger } from '@nestjs/common';
import { Twilio } from 'twilio';
import {
  NotificationProvider,
  SendNotificationInput,
  SendNotificationResult,
} from './notification-provider';
import { NotificationChannel } from '../schemas/notification-template.schema';

@Injectable()
export class TwilioNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(TwilioNotificationProvider.name);
  private clientCache?: Twilio;

  // Lazy: only construct the client on first send so the app can boot in dev
  // without Twilio credentials when NOTIFICATION_PROVIDER=console.
  private get client(): Twilio {
    if (!this.clientCache) {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) {
        throw new Error(
          'Twilio provider selected but TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are missing.',
        );
      }
      this.clientCache = new Twilio(sid, token);
    }
    return this.clientCache;
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const isWhatsApp = input.channel === NotificationChannel.WhatsApp;
    const fromRaw = isWhatsApp
      ? process.env.TWILIO_WHATSAPP_FROM
      : process.env.TWILIO_SMS_FROM;
    if (!fromRaw) {
      throw new Error(
        `Missing ${isWhatsApp ? 'TWILIO_WHATSAPP_FROM' : 'TWILIO_SMS_FROM'} env var.`,
      );
    }

    const from = isWhatsApp ? `whatsapp:${fromRaw}` : fromRaw;
    const to = isWhatsApp ? `whatsapp:${input.to}` : input.to;

    const msg = await this.client.messages.create({
      from,
      to,
      body: input.body,
    });

    this.logger.log(
      `Twilio ${input.channel} sent sid=${msg.sid} status=${msg.status} to=${input.to}`,
    );

    return {
      providerMessageId: msg.sid,
      providerResponse: {
        status: msg.status,
        errorCode: msg.errorCode ?? null,
        errorMessage: msg.errorMessage ?? null,
      },
    };
  }
}
