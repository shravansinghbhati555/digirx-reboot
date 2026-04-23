import { DynamicModule, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationLog, NotificationLogSchema } from './schemas/notification-log.schema';
import { NotificationTemplate, NotificationTemplateSchema } from './schemas/notification-template.schema';
import { NOTIFICATIONS_QUEUE } from './notifications.queue';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConsoleNotificationProvider } from './providers/console.provider';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsScheduler } from './notifications.scheduler';
import { Appointment, AppointmentSchema } from '../appointments/schemas/appointment.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';

@Module({})
export class NotificationsModule {
  static forRoot(): DynamicModule {
    const enableQueue = (process.env.NOTIFICATIONS_QUEUE_ENABLED ?? 'false').toLowerCase() === 'true';
    const redisUrl = process.env.REDIS_URL;

    const imports = [
      ScheduleModule.forRoot(),
      MongooseModule.forFeature([
        { name: NotificationTemplate.name, schema: NotificationTemplateSchema },
        { name: NotificationLog.name, schema: NotificationLogSchema },
        { name: Appointment.name, schema: AppointmentSchema },
        { name: Patient.name, schema: PatientSchema },
      ]),
    ];

    if (enableQueue && redisUrl) {
      imports.push(
        BullModule.forRoot({
          connection: { url: redisUrl },
        }),
        BullModule.registerQueue({
          name: NOTIFICATIONS_QUEUE,
        }),
      );
    }

    return {
      module: NotificationsModule,
      imports,
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        ConsoleNotificationProvider,
        NotificationsScheduler,
        ...(enableQueue && redisUrl ? [NotificationsProcessor] : []),
      ],
      exports: [NotificationsService],
    };
  }
}

