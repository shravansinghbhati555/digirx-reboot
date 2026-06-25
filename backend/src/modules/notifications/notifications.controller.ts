import { Body, Controller, Get, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { TestNotificationDto } from './dto/test-notification.dto';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { NotificationsService } from './notifications.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotificationLog } from './schemas/notification-log.schema';
import { NotificationTemplate } from './schemas/notification-template.schema';
import { Patient } from '../patients/schemas/patient.schema';
import { normalizePhone } from '../patients/patient.utils';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @InjectModel(NotificationLog.name)
    private readonly logModel: Model<NotificationLog>,
    @InjectModel(NotificationTemplate.name)
    private readonly templateModel: Model<NotificationTemplate>,
    @InjectModel(Patient.name)
    private readonly patientModel: Model<Patient>,
  ) {}

  /**
   * Resolve a patient name for each log's `to` recipient by matching the
   * phone against patient `normalizedPhones` (and email against `emails`).
   * Returns plain objects with an added `recipientName` so the UI can show
   * "Anjali Mehta · 98765…" instead of just the number. Batched into two
   * `$in` queries — no per-log round trips.
   */
  private async attachRecipientNames(
    clinicId: Types.ObjectId,
    logs: NotificationLog[],
  ): Promise<Array<NotificationLog & { recipientName?: string }>> {
    const phoneKeys = new Set<string>();
    const emailKeys = new Set<string>();
    for (const l of logs) {
      const to = (l.to ?? '').trim();
      if (!to) continue;
      if (to.includes('@')) emailKeys.add(to.toLowerCase());
      else {
        const np = normalizePhone(to);
        if (np) phoneKeys.add(np);
      }
    }

    const patients = (phoneKeys.size || emailKeys.size)
      ? await this.patientModel
          .find({
            clinicId,
            $or: [
              ...(phoneKeys.size ? [{ normalizedPhones: { $in: Array.from(phoneKeys) } }] : []),
              ...(emailKeys.size ? [{ emails: { $in: Array.from(emailKeys) } }] : []),
            ],
          })
          .select({ fullName: 1, normalizedPhones: 1, emails: 1 })
          .lean()
      : [];

    const byPhone = new Map<string, string>();
    const byEmail = new Map<string, string>();
    for (const p of patients) {
      const name = (p as { fullName?: string }).fullName;
      if (!name) continue;
      for (const np of ((p as { normalizedPhones?: string[] }).normalizedPhones ?? [])) byPhone.set(np, name);
      for (const em of ((p as { emails?: string[] }).emails ?? [])) byEmail.set(em.toLowerCase(), name);
    }

    return logs.map((l) => {
      const to = (l.to ?? '').trim();
      let recipientName: string | undefined;
      if (to.includes('@')) recipientName = byEmail.get(to.toLowerCase());
      else recipientName = byPhone.get(normalizePhone(to));
      return { ...(l as any), recipientName };
    });
  }

  @Post('test')
  @RequirePermissions(Permission.NotificationWrite)
  async test(@Req() req: AppRequest, @Body() dto: TestNotificationDto) {
    return await this.notifications.enqueueSend({
      clinicId: req.context!.clinicId,
      branchId: req.context!.branchId,
      channel: dto.channel,
      to: dto.to,
      body: dto.body,
    });
  }

  @Get('logs')
  @RequirePermissions(Permission.NotificationRead)
  async logs(
    @Req() req: AppRequest,
    @Query('limit') limitRaw?: string,
    @Query('branchId') branchId?: string,
  ) {
    const limit = Math.max(1, Math.min(200, Number(limitRaw ?? 50) || 50));
    const filter: Record<string, unknown> = { clinicId: req.context!.clinicId };
    // Branch scoping is permissive: when a branch is requested we
    // include rows for that branch AND legacy rows that pre-date the
    // branchId field. Otherwise switching to a freshly-created branch
    // would show an empty log even though the clinic clearly has
    // historical activity.
    if (branchId && Types.ObjectId.isValid(branchId)) {
      const branchObj = new Types.ObjectId(branchId);
      filter.$or = [
        { branchId: branchObj },
        { branchId: { $exists: false } },
        { branchId: null },
      ];
    }
    const logs = await this.logModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return await this.attachRecipientNames(req.context!.clinicId, logs as NotificationLog[]);
  }

  @Get('logs/:id')
  @RequirePermissions(Permission.NotificationRead)
  async logById(@Req() req: AppRequest, @Param('id') id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Notification log not found');
    }
    const log = await this.logModel.findOne({
      _id: id,
      clinicId: req.context!.clinicId,
    }).lean();
    if (!log) throw new NotFoundException('Notification log not found');
    const [withName] = await this.attachRecipientNames(req.context!.clinicId, [log as NotificationLog]);
    return withName;
  }

  @Get('templates')
  @RequirePermissions(Permission.NotificationRead)
  async templates(@Req() req: AppRequest) {
    return await this.templateModel
      .find({ clinicId: req.context!.clinicId })
      .sort({ channel: 1, key: 1 });
  }

  @Post('templates')
  @RequirePermissions(Permission.NotificationWrite)
  async upsertTemplate(
    @Req() req: AppRequest,
    @Body() body: UpsertTemplateDto,
  ) {
    const doc = await this.templateModel.findOneAndUpdate(
      { clinicId: req.context!.clinicId, channel: body.channel, key: body.key },
      { $set: { body: body.body, active: body.active ?? true } },
      { upsert: true, new: true },
    );
    return doc;
  }
}
