import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  NotificationLog,
  NotificationStatus,
} from './schemas/notification-log.schema';
import {
  NOTIFICATIONS_JOB_SEND,
  NOTIFICATIONS_QUEUE,
} from './notifications.queue';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider';
import type { NotificationProvider } from './providers/notification-provider';

@Processor(NOTIFICATIONS_QUEUE)
export class NotificationsProcessor extends WorkerHost {
  constructor(
    @InjectModel(NotificationLog.name)
    private readonly logModel: Model<NotificationLog>,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly provider: NotificationProvider,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    if (job.name !== NOTIFICATIONS_JOB_SEND) return;

    const { notificationLogId } = job.data as { notificationLogId: string };
    const log = await this.logModel.findById(notificationLogId);
    if (!log) return;

    try {
      log.attempts = (log.attempts ?? 0) + 1;
      const res = await this.provider.send({
        channel: log.channel,
        to: log.to,
        body: log.body,
      });
      log.status = NotificationStatus.Sent;
      log.providerMessageId = res.providerMessageId;
      log.providerResponse = res.providerResponse;
      log.lastError = undefined;
      await log.save();
    } catch (e) {
      log.status = NotificationStatus.Failed;
      log.lastError = e instanceof Error ? e.message : 'Unknown error';
      await log.save();
      throw e;
    }
  }
}
