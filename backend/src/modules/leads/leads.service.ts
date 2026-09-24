import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadStatus } from './schemas/lead.schema';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { NOTIFICATION_PROVIDER } from '../notifications/providers/notification-provider';
// Type-only: the interface is referenced in a decorated constructor, which
// `isolatedModules` + `emitDecoratorMetadata` require to be imported as a type.
import type { NotificationProvider } from '../notifications/providers/notification-provider';
import { NotificationChannel } from '../notifications/schemas/notification-template.schema';
import { parseRecipientList } from '../notifications/recipients';

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly notifications: NotificationProvider,
  ) {}

  /**
   * Store an enquiry from the marketing site, then email the sales inbox.
   *
   * The email is fire-and-forget on purpose: a visitor filling in a contact
   * form should never see a failure because SendGrid is misconfigured. The
   * lead is already saved by then, and `notified` records whether the email
   * actually went out so a broken mailer is visible in the inbox instead of
   * silently losing leads.
   */
  async create(input: CreateLeadDto) {
    const lead = await this.leadModel.create({
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim(),
      reason: input.reason?.trim(),
      message: input.message.trim(),
      source: input.source?.trim() || 'website',
      status: LeadStatus.New,
    });

    const notified = await this.notifySalesInbox(lead);
    if (notified) {
      await this.leadModel.updateOne({ _id: lead._id }, { $set: { notified: true } });
    }

    return {
      id: lead._id.toHexString(),
      status: lead.status,
      message: 'Thanks. Your message has reached our team and we will reply shortly.',
    };
  }

  /** Inbox for platform admins. */
  async list(input: { status?: string; query?: string; limit?: number }) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const filter: Record<string, unknown> = {};

    if (input.status && input.status !== 'ALL') {
      const status = input.status.toUpperCase();
      if (!(Object.values(LeadStatus) as string[]).includes(status)) {
        throw new BadRequestException(`Unknown lead status: ${input.status}`);
      }
      filter.status = status;
    }

    if (input.query?.trim()) {
      const rx = new RegExp(input.query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { message: rx }];
    }

    const rows = await this.leadModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();

    return {
      rows: rows.map((lead) => ({
        _id: lead._id.toHexString(),
        name: lead.name,
        email: lead.email,
        phone: lead.phone ?? null,
        reason: lead.reason ?? null,
        message: lead.message,
        source: lead.source ?? 'website',
        status: lead.status,
        notes: lead.notes ?? null,
        notified: lead.notified === true,
        handledAt: lead.handledAt ?? null,
        createdAt: (lead as { createdAt?: Date }).createdAt ?? null,
      })),
    };
  }

  /** Counts for the inbox tabs. */
  async summary() {
    const rows = await this.leadModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const counts: Record<string, number> = {
      [LeadStatus.New]: 0,
      [LeadStatus.Contacted]: 0,
      [LeadStatus.Won]: 0,
      [LeadStatus.Closed]: 0,
    };
    let total = 0;
    for (const row of rows) {
      counts[row._id] = (counts[row._id] ?? 0) + row.count;
      total += row.count;
    }
    return { counts, total };
  }

  async update(id: string, actorUserId: Types.ObjectId, input: UpdateLeadDto) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid lead id');

    const set: Record<string, unknown> = {};
    if (input.status) {
      set.status = input.status;
      // Anything past NEW counts as handled, so the inbox can show who picked
      // it up and when without a separate action.
      set.handledAt = input.status === LeadStatus.New ? null : new Date();
      set.handledByUserId = input.status === LeadStatus.New ? null : actorUserId;
    }
    if (input.notes !== undefined) set.notes = input.notes;

    if (Object.keys(set).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const lead = await this.leadModel.findByIdAndUpdate(
      new Types.ObjectId(id),
      { $set: set },
      { new: true },
    );
    if (!lead) throw new NotFoundException('Lead not found');

    return {
      _id: lead._id.toHexString(),
      status: lead.status,
      notes: lead.notes ?? null,
      handledAt: lead.handledAt ?? null,
    };
  }

  /**
   * Email the enquiry to whoever handles sales.
   *
   * Uses the same provider the rest of the app sends through, so it obeys
   * NOTIFICATION_PROVIDER: real mail when SendGrid is configured, a log line
   * otherwise. Returns whether it was actually accepted for delivery.
   */
  private async notifySalesInbox(lead: Lead & { _id: Types.ObjectId }): Promise<boolean> {
    // The var takes a comma-separated list, so a second person can be copied
    // in without anyone having to watch one inbox.
    const recipients = parseRecipientList(process.env.LEADS_NOTIFY_EMAIL);
    if (recipients.length === 0) {
      this.logger.warn(
        'LEADS_NOTIFY_EMAIL is not set — lead saved but no email sent. Set it in .env to receive enquiries.',
      );
      return false;
    }

    const lines = [
      'New enquiry from the DigiRx website',
      '',
      `Name:    ${lead.name}`,
      `Email:   ${lead.email}`,
      `Phone:   ${lead.phone || 'not provided'}`,
      `Topic:   ${lead.reason || 'not specified'}`,
      `Source:  ${lead.source || 'website'}`,
      '',
      'Message:',
      lead.message,
      '',
      `Reply to: ${lead.email}`,
    ];

    const body = lines.join('\n');

    // One message per recipient: a single bad address then costs only its own
    // delivery, and the enquiry still reaches everyone else.
    const results = await Promise.all(
      recipients.map(async (to) => {
        try {
          await this.notifications.send({
            channel: NotificationChannel.Email,
            to,
            body,
          });
          return true;
        } catch (e) {
          // Never fail the visitor's submission because of the mailer.
          this.logger.error(
            `Lead ${lead._id.toHexString()} saved but the notification email to ${to} failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          return false;
        }
      }),
    );

    // `notified` means somebody got it — a partial failure is already logged.
    return results.some(Boolean);
  }
}
