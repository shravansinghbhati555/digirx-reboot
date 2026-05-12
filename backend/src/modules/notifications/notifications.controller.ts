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

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    @InjectModel(NotificationLog.name)
    private readonly logModel: Model<NotificationLog>,
    @InjectModel(NotificationTemplate.name)
    private readonly templateModel: Model<NotificationTemplate>,
  ) {}

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
    return await this.logModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);
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
    });
    if (!log) throw new NotFoundException('Notification log not found');
    return log;
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
