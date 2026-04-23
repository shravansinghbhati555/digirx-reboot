import { Injectable, Inject, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import { NotificationLog, NotificationStatus } from './schemas/notification-log.schema';
import { NotificationChannel } from './schemas/notification-template.schema';
import { NOTIFICATIONS_JOB_SEND, NOTIFICATIONS_QUEUE } from './notifications.queue';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(NotificationLog.name) private readonly logModel: Model<NotificationLog>,
    @Optional() @Inject(getQueueToken(NOTIFICATIONS_QUEUE)) private readonly queue?: Queue,
  ) {}

  async enqueueSend(input: {
    clinicId: Types.ObjectId;
    branchId?: Types.ObjectId;
    channel: NotificationChannel;
    to: string;
    body: string;
    dedupeKey?: string;
  }) {
    const log = await this.logModel.create({
      clinicId: input.clinicId,
      branchId: input.branchId,
      channel: input.channel,
      to: input.to,
      body: input.body,
      dedupeKey: input.dedupeKey,
      status: NotificationStatus.Queued,
      attempts: 0,
    });

    // If queue is not configured/available, we leave it queued; worker will process when enabled.
    if (this.queue) {
      await this.queue.add(
        NOTIFICATIONS_JOB_SEND,
        { notificationLogId: log._id.toHexString() },
        { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 1000, removeOnFail: 1000 },
      );
    }

    return log;
  }
}

