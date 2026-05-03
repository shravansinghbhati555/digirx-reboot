import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { TestNotificationDto } from './dto/test-notification.dto';
import { UpsertTemplateDto } from './dto/upsert-template.dto';
import { NotificationsService } from './notifications.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
  async logs(@Req() req: AppRequest, @Query('limit') limitRaw?: string) {
    const limit = Math.max(1, Math.min(200, Number(limitRaw ?? 50) || 50));
    return await this.logModel
      .find({ clinicId: req.context!.clinicId })
      .sort({ createdAt: -1 })
      .limit(limit);
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
