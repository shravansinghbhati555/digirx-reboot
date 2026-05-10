import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import {
  NotificationLog,
  NotificationStatus,
} from './schemas/notification-log.schema';
import { NotificationChannel } from './schemas/notification-template.schema';
import {
  NOTIFICATIONS_JOB_SEND,
  NOTIFICATIONS_QUEUE,
} from './notifications.queue';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(NotificationLog.name)
    private readonly logModel: Model<NotificationLog>,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @Optional()
    @Inject(getQueueToken(NOTIFICATIONS_QUEUE))
    private readonly queue?: Queue,
  ) {}

  /**
   * Returns true when the given channel is enabled in the clinic's settings.
   * Defaults to true when settings are missing/malformed (mergeClinicSettings
   * fills defaults — both channels default to enabled).
   */
  async isChannelEnabled(
    clinicId: Types.ObjectId,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const clinic = await this.clinicModel.findById(clinicId);
    const settings = mergeClinicSettings(clinic?.settings);
    if (channel === NotificationChannel.Sms) {
      return settings.modules.notifications.sms.enabled;
    }
    if (channel === NotificationChannel.WhatsApp) {
      return settings.modules.notifications.whatsapp.enabled;
    }
    return true;
  }

  async enqueueSend(input: {
    clinicId: Types.ObjectId;
    branchId?: Types.ObjectId;
    channel: NotificationChannel;
    to: string;
    body: string;
    dedupeKey?: string;
    templateKey?: string;
  }) {
    const enabled = await this.isChannelEnabled(input.clinicId, input.channel);

    // When the channel is disabled in clinic settings we still write a row for
    // observability — status=Skipped — but never enqueue, so the worker has no
    // orphaned jobs to process when the toggle is flipped.
    const log = await this.logModel.create({
      clinicId: input.clinicId,
      branchId: input.branchId,
      channel: input.channel,
      to: input.to,
      body: input.body,
      dedupeKey: input.dedupeKey,
      templateKey: input.templateKey,
      status: enabled ? NotificationStatus.Queued : NotificationStatus.Skipped,
      attempts: 0,
    });

    if (enabled && this.queue) {
      await this.queue.add(
        NOTIFICATIONS_JOB_SEND,
        { notificationLogId: log._id.toHexString() },
        {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 1000,
        },
      );
    }

    return log;
  }
}
