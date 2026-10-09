import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider';
// Type-only: the interface is referenced in a decorated constructor, which
// `isolatedModules` + `emitDecoratorMetadata` require to be imported as a type.
import type { NotificationProvider } from './providers/notification-provider';
import { NotificationChannel } from './schemas/notification-template.schema';
import { parseRecipientList } from './recipients';
import {
  ClinicLifecycleEmail,
  clinicActivatedEmail,
  clinicRegistrationInternalEmail,
  clinicRegistrationReceivedEmail,
} from './emails/clinic-lifecycle.emails';

/**
 * Transactional mail for the clinic approval lifecycle.
 *
 * Sends straight through the configured provider rather than via
 * `NotificationsService`, for the same reason the leads inbox does: these
 * mails are platform-level, not clinic-scoped, so they have no template row
 * and no `NotificationLog` tenant to belong to.
 *
 * Every send here is best-effort. A clinic registration must not fail because
 * SendGrid is down, and an approval must not fail because the applicant
 * mistyped their address — the state change is what matters, the mail is a
 * courtesy on top. Failures are logged and reported back as `false` so the
 * caller can record whether it went out.
 */
@Injectable()
export class ClinicMailService {
  private readonly logger = new Logger(ClinicMailService.name);

  constructor(
    @Inject(NOTIFICATION_PROVIDER)
    private readonly notifications: NotificationProvider,
  ) {}

  /** Where the marketing/app frontend lives, for links in the mail. */
  private get appUrl(): string | undefined {
    const raw = (
      process.env.FRONTEND_URL ?? process.env.FRONTEND_ORIGIN
    )?.trim();
    return raw ? raw.replace(/\/+$/, '') : undefined;
  }

  private get logoUrl(): string | undefined {
    return process.env.EMAIL_LOGO_URL?.trim() || undefined;
  }

  /**
   * Both mails for a fresh registration: a receipt to the applicant and a
   * heads-up to the platform inbox.
   *
   * They are sent independently so a bad applicant address still gets the
   * team notified, and a missing LEADS_NOTIFY_EMAIL still gets the applicant
   * their receipt.
   */
  async sendRegistrationEmails(ctx: {
    clinicId: string;
    clinicName: string;
    adminName: string;
    adminEmail: string;
    countryCode?: string;
    timezone?: string;
    currency?: string;
    requestedAt?: Date;
  }): Promise<{ applicantNotified: boolean; teamNotified: boolean }> {
    const logoUrl = this.logoUrl;

    const applicantNotified = await this.deliver(
      ctx.adminEmail,
      clinicRegistrationReceivedEmail({ ...ctx, logoUrl }),
      `registration receipt for clinic ${ctx.clinicId}`,
    );

    const teamInbox = parseRecipientList(process.env.LEADS_NOTIFY_EMAIL);
    let teamNotified = false;
    if (teamInbox.length > 0) {
      const alert = clinicRegistrationInternalEmail({
        ...ctx,
        logoUrl,
        consoleUrl: this.appUrl,
      });

      // One message each rather than one message with several recipients:
      // a single bad address then costs only its own delivery, and nobody
      // sees the rest of the team's addresses.
      const results = await Promise.all(
        teamInbox.map((to) =>
          this.deliver(to, alert, `approval-queue alert for clinic ${ctx.clinicId}`),
        ),
      );
      // One delivery is enough for the registration to have been seen.
      teamNotified = results.some(Boolean);
    } else {
      this.logger.warn(
        `LEADS_NOTIFY_EMAIL is not set — clinic ${ctx.clinicId} is waiting in the approval queue with nobody emailed about it.`,
      );
    }

    return { applicantNotified, teamNotified };
  }

  /** The "you're live" mail, sent when a clinic is approved. */
  async sendClinicActivatedEmail(ctx: {
    clinicId: string;
    clinicName: string;
    adminName?: string;
    adminEmail?: string;
  }): Promise<boolean> {
    if (!ctx.adminEmail) {
      // Clinics created before the approval queue existed, or by an operator
      // on someone's behalf, have no recorded applicant address.
      this.logger.warn(
        `Clinic ${ctx.clinicId} was activated but has no administrator email on file — no activation mail sent.`,
      );
      return false;
    }

    return this.deliver(
      ctx.adminEmail,
      clinicActivatedEmail({
        clinicName: ctx.clinicName,
        adminName: ctx.adminName,
        adminEmail: ctx.adminEmail,
        loginUrl: this.appUrl,
        logoUrl: this.logoUrl,
      }),
      `activation mail for clinic ${ctx.clinicId}`,
    );
  }

  private async deliver(
    to: string,
    email: ClinicLifecycleEmail,
    what: string,
  ): Promise<boolean> {
    try {
      await this.notifications.send({
        channel: NotificationChannel.Email,
        to,
        subject: email.subject,
        // The plain-text twin doubles as the body the console provider logs.
        body: email.text,
        html: email.html,
      });
      this.logger.log(`Sent ${what} to ${to}`);
      return true;
    } catch (e) {
      this.logger.error(
        `Failed to send ${what} to ${to}: ${e instanceof Error ? e.message : String(e)}`,
      );
      return false;
    }
  }
}
