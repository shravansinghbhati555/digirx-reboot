import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import {
  NotificationProvider,
  SendNotificationInput,
  SendNotificationResult,
} from './notification-provider';
import { NotificationChannel } from '../schemas/notification-template.schema';
import { ConsoleNotificationProvider } from './console.provider';
import { deriveSubject, toHtmlBody } from './email-format';

/**
 * Email delivery over plain SMTP, selected with `NOTIFICATION_PROVIDER=smtp`.
 *
 * The lighter alternative to SendGrid: any mailbox that issues an app
 * password (Gmail, Outlook, Zoho, a cPanel host) works with no account
 * signup. Good enough for lead notifications and internal mail; move to a
 * real sending service before doing patient-facing volume, since consumer
 * mailboxes have low daily send limits and land in spam more easily.
 *
 * SMS and WhatsApp have no SMTP equivalent, so those fall through to the
 * console provider rather than throwing — a clinic running appointment
 * reminders should not have its worker crash because email was configured
 * this way.
 */
@Injectable()
export class SmtpNotificationProvider implements NotificationProvider {
  private readonly logger = new Logger(SmtpNotificationProvider.name);
  private transporterCache?: Transporter;

  constructor(private readonly consoleProvider: ConsoleNotificationProvider) {}

  /**
   * Built on first send so the app boots without SMTP credentials, matching
   * how the Twilio provider defers its own client.
   */
  private get transporter(): Transporter {
    if (this.transporterCache) return this.transporterCache;

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      throw new Error(
        'SMTP provider selected but SMTP_HOST / SMTP_USER / SMTP_PASS are missing.',
      );
    }

    const port = Number(process.env.SMTP_PORT ?? 587);
    // Port 465 is implicit TLS; 587 and 25 start plain and upgrade with
    // STARTTLS. Getting this pair wrong is the usual cause of a connection
    // that hangs rather than failing outright.
    const secure =
      process.env.SMTP_SECURE !== undefined
        ? process.env.SMTP_SECURE === 'true'
        : port === 465;

    this.transporterCache = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    this.logger.log(`SMTP transport ready: ${host}:${port} secure=${secure}`);
    return this.transporterCache;
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    if (input.channel !== NotificationChannel.Email) {
      this.logger.warn(
        `${input.channel} requested but the SMTP provider only sends email — falling back to console.`,
      );
      return this.consoleProvider.send(input);
    }

    const fromEmail = process.env.EMAIL_FROM ?? process.env.SMTP_USER;
    const fromName = process.env.EMAIL_FROM_NAME;
    if (!fromEmail) {
      throw new Error('Missing EMAIL_FROM (or SMTP_USER) for outbound email.');
    }

    const subject = deriveSubject(input.body);

    const info = await this.transporter.sendMail({
      to: input.to,
      from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
      subject,
      text: input.body,
      html: toHtmlBody(input.body),
    });

    this.logger.log(`SMTP email sent to=${input.to} subject="${subject}" id=${info.messageId}`);

    return {
      providerMessageId: info.messageId,
      providerResponse: {
        accepted: info.accepted,
        rejected: info.rejected,
        response: info.response,
      },
    };
  }

  /**
   * Opens the connection and authenticates without sending anything, so a
   * misconfigured mailbox surfaces at setup rather than on the first real
   * enquiry.
   */
  async verify(): Promise<true> {
    await this.transporter.verify();
    return true;
  }
}
