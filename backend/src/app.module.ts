import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { LoggerModule } from 'nestjs-pino';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ClinicContextMiddleware } from './common/clinic-context.middleware';
import { RetentionModule } from './common/retention/retention.module';
import { AppThrottlerModule } from './common/throttler.config';
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { AuthzModule } from './modules/authz/authz.module';
import { PermissionsGuard } from './modules/authz/permissions.guard';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { PatientsModule } from './modules/patients/patients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { EncountersModule } from './modules/encounters/encounters.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { BillingModule } from './modules/billing/billing.module';
import { CreditNotesModule } from './modules/credit-notes/credit-notes.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AccessLogsModule } from './modules/access-logs/access-logs.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { StorageModule } from './modules/storage/storage.module';

@Module({
  imports: [
    // Pino: structured JSON in prod, single-line pretty output in dev. The
    // `redact` rules belt-and-brace the audit-log redactor by also masking
    // sensitive keys in HTTP request log lines.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
              },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-user-id"]',
            'req.body.password',
            'req.body.newPassword',
          ],
          remove: true,
        },
        // Drop /health and /metrics request lines — they fire on a tight
        // cadence and bury the signal.
        autoLogging: {
          ignore: (req: any) => req.url === '/health' || req.url === '/metrics',
        },
        customProps: (req: any) => ({
          clinicId: req?.context?.clinicId?.toHexString?.(),
          actorUserId: req?.context?.actorUserId?.toHexString?.(),
        }),
      },
    }),
    AppThrottlerModule,
    RetentionModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/digirx',
    ),
    AuditModule,
    AuthModule,
    AuthzModule,
    TenancyModule,
    AvailabilityModule,
    PatientsModule,
    AppointmentsModule,
    EncountersModule,
    PrescriptionsModule,
    MedicinesModule,
    BillingModule,
    CreditNotesModule,
    InventoryModule,
    AnalyticsModule,
    PdfModule,
    StorageModule,
    NotificationsModule.forRoot(),
    ReportsModule,
    AccessLogsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ClinicContextMiddleware)
      .exclude(
        { path: '/', method: RequestMethod.GET },
        { path: '', method: RequestMethod.GET },
        'health',
        'metrics',
        { path: 'auth/*path', method: RequestMethod.ALL },
        { path: 'auth', method: RequestMethod.ALL },
        { path: 'clinic/search', method: RequestMethod.GET },
        { path: 'clinic/:id/branches', method: RequestMethod.GET },
        { path: 'share/*path', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
