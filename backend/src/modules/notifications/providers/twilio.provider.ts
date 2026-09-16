import { Injectable, Logger } from '@nestjs/common';
import sendgrid from '@sendgrid/mail';
import { Twilio } from 'twilio';
import {
  NotificationProvider,
  SendNotificationInput,
  SendNotificationResult,
} from './notification-provider';
import { NotificationChannel } from '../schemas/notification-template.schema';
import { deriveSubject, toHtmlBody } from './email-format';

/**
 * Real-delivery provider for SMS + WhatsApp (Twilio) and Email (Twilio
 * SendGrid). Selected at boot when `NOTIFICATION_PROVIDER=twilio` — the
 * default is the console provider so dev environments don't need any
 * external credentials.
 *
 * SendGrid is part of the Twilio family of products, so keeping all three
 * channels in this provider keeps the integration story coherent: one env
 * setting, one provider class.
 */
@Injectable()
export class TwilioNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(TwilioNotificationProvider.name);
  private clientCache?: Twilio;
  private sendgridConfigured = false;

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

  // Lazy SendGrid initialisation. Same rationale as the Twilio client —
  // the API key check happens on first email send, not at app boot, so a
  // clinic that only uses SMS/WhatsApp doesn't need SENDGRID_API_KEY set.
  private configureSendgrid() {
    if (this.sendgridConfigured) return;
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Email send requested but SENDGRID_API_KEY is missing.',
      );
    }
    sendgrid.setApiKey(apiKey);
    this.sendgridConfigured = true;
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    if (input.channel === NotificationChannel.Email) {
      return this.sendEmail(input);
    }
    return this.sendTwilio(input);
  }

  private async sendEmail(
    input: SendNotificationInput,
  ): Promise<SendNotificationResult> {
    this.configureSendgrid();

    const fromEmail = process.env.EMAIL_FROM;
    const fromName = process.env.EMAIL_FROM_NAME;
    if (!fromEmail) {
      throw new Error('Missing EMAIL_FROM env var for outbound email.');
    }

    // The notification body is plain text (it's also reused for SMS and
    // WhatsApp). Convert newlines to <br/> so the HTML version reads the
    // same on email clients that prefer HTML, while keeping plain-text
    // delivery for everyone else (multipart MIME).
    const subject = deriveSubject(input.body);
    const htmlBody = toHtmlBody(input.body);

    const [res] = await sendgrid.send({
      to: input.to,
      from: fromName ? { email: fromEmail, name: fromName } : fromEmail,
      subject,
      text: input.body,
      html: htmlBody,
    });

    const messageId =
      (res.headers as Record<string, string | undefined>)['x-message-id'] ??
      `sendgrid_${Date.now()}`;

    this.logger.log(
      `SendGrid email sent status=${res.statusCode} to=${input.to} subject="${subject}"`,
    );

    return {
      providerMessageId: messageId,
      providerResponse: {
        statusCode: res.statusCode,
        // SendGrid doesn't return a body on 202 — surface the headers we
        // care about so the log row has useful debug info.
        xMessageId: messageId,
      },
    };
  }

  private async sendTwilio(
    input: SendNotificationInput,
  ): Promise<SendNotificationResult> {
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
