import { DynamicModule, Logger, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import {
  NotificationLog,
  NotificationLogSchema,
} from './schemas/notification-log.schema';
import {
  NotificationTemplate,
  NotificationTemplateSchema,
} from './schemas/notification-template.schema';
import { NOTIFICATIONS_QUEUE } from './notifications.queue';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { ConsoleNotificationProvider } from './providers/console.provider';
import { TwilioNotificationProvider } from './providers/twilio.provider';
import { SmtpNotificationProvider } from './providers/smtp.provider';
import { NOTIFICATION_PROVIDER } from './providers/notification-provider';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsScheduler } from './notifications.scheduler';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';

@Module({})
export class NotificationsModule {
  static forRoot(): DynamicModule {
    const enableQueue =
      (process.env.NOTIFICATIONS_QUEUE_ENABLED ?? 'false').toLowerCase() ===
      'true';
    const redisUrl = process.env.REDIS_URL;

    const imports = [
      ScheduleModule.forRoot(),
      MongooseModule.forFeature([
        { name: NotificationTemplate.name, schema: NotificationTemplateSchema },
        { name: NotificationLog.name, schema: NotificationLogSchema },
        { name: Appointment.name, schema: AppointmentSchema },
        { name: Patient.name, schema: PatientSchema },
        { name: Clinic.name, schema: ClinicSchema },
        { name: Branch.name, schema: BranchSchema },
        { name: User.name, schema: UserSchema },
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
      // Expose NotificationsService globally so feature modules (e.g.
      // prescriptions, when sending the share link via SMS/WhatsApp) can
      // inject it without each calling forRoot() again — repeated forRoot
      // calls would re-register BullMQ queues.
      global: true,
      module: NotificationsModule,
      imports,
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        ConsoleNotificationProvider,
        TwilioNotificationProvider,
        SmtpNotificationProvider,
        {
          // Single source of truth for which provider the worker uses.
          // Toggle via NOTIFICATION_PROVIDER env var (one line in .env).
          provide: NOTIFICATION_PROVIDER,
          useFactory: (
            consoleP: ConsoleNotificationProvider,
            twilioP: TwilioNotificationProvider,
            smtpP: SmtpNotificationProvider,
          ) => {
            const choice = (
              process.env.NOTIFICATION_PROVIDER ?? 'console'
            ).toLowerCase();
            const log = new Logger('NotificationsModule');
            if (choice === 'twilio') {
              log.log('Notification provider: TWILIO (real SMS/WhatsApp/email)');
              return twilioP;
            }
            if (choice === 'smtp') {
              // Real email over SMTP. SMS and WhatsApp have no SMTP
              // equivalent, so the provider logs those to the console
              // rather than failing the job.
              log.log('Notification provider: SMTP (real email, console for SMS/WhatsApp)');
              return smtpP;
            }
            log.log('Notification provider: CONSOLE (no real delivery)');
            return consoleP;
          },
          inject: [
            ConsoleNotificationProvider,
            TwilioNotificationProvider,
            SmtpNotificationProvider,
          ],
        },
        NotificationsScheduler,
        ...(enableQueue && redisUrl ? [NotificationsProcessor] : []),
      ],
      // NOTIFICATION_PROVIDER is exported so platform-level features that are
      // not clinic-scoped (the leads inbox) can send through the same
      // configured provider without going via NotificationsService.
      exports: [NotificationsService, NOTIFICATION_PROVIDER],
    };
  }
}
