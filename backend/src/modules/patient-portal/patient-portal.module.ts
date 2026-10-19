import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PatientIdentitiesModule } from '../patient-identities/patient-identities.module';
import { FamilyModule } from '../family/family.module';
import { RecordAccessModule } from '../record-access/record-access.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PatientsModule } from '../patients/patients.module';
import { BillingModule } from '../billing/billing.module';
import { PrescriptionsModule } from '../prescriptions/prescriptions.module';
import { DocumentsModule } from '../documents/documents.module';
import { StorageModule } from '../storage/storage.module';
import { AuthzModule } from '../authz/authz.module';
import { AuditModule } from '../audit/audit.module';
import { AccessLogsModule } from '../access-logs/access-logs.module';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import {
  DoctorProfile,
  DoctorProfileSchema,
} from '../appointments/schemas/doctor-profile.schema';
import {
  DoctorAvailabilityRule,
  DoctorAvailabilityRuleSchema,
} from '../availability/schemas/doctor-availability-rule.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { Payment, PaymentSchema } from '../billing/schemas/payment.schema';
import {
  ServiceCatalogItem,
  ServiceCatalogItemSchema,
} from '../billing/schemas/service-catalog-item.schema';
import {
  VisitType,
  VisitTypeSchema,
} from '../visit-types/schemas/visit-type.schema';
import {
  Encounter,
  EncounterSchema,
} from '../encounters/schemas/encounter.schema';
import {
  Prescription,
  PrescriptionSchema,
} from '../prescriptions/schemas/prescription.schema';
import { Document, DocumentSchema } from '../documents/schemas/document.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import {
  MedicineCatalogItem,
  MedicineCatalogItemSchema,
} from '../medicines/schemas/medicine-catalog-item.schema';
import {
  PortalPaymentOrder,
  PortalPaymentOrderSchema,
} from './schemas/portal-payment-order.schema';
import { PortalAuthController } from './controllers/portal-auth.controller';
import { PortalController } from './controllers/portal.controller';
import { PortalAuthGuard, PortalEnabledGuard } from './portal.guards';
import { PortalAccessLogInterceptor } from './portal-access-log.interceptor';
import { PortalAuditService } from './services/portal-audit.service';
import { PortalScopeService } from './services/portal-scope.service';
import { PortalDirectoryService } from './services/portal-directory.service';
import { PortalAppointmentsService } from './services/portal-appointments.service';
import { PortalRecordsService } from './services/portal-records.service';
import { PortalPaymentsService } from './services/portal-payments.service';
import { PortalFamilyService } from './services/portal-family.service';
import { PortalMeService } from './services/portal-me.service';

/**
 * Patient-portal API (`/portal/*`). Orchestration only: scheduling, billing,
 * prescriptions and documents all go through the clinic app's existing
 * services. Collections it reads are registered here read-side; the only
 * collection it owns is `portalpaymentorders`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: DoctorProfile.name, schema: DoctorProfileSchema },
      {
        name: DoctorAvailabilityRule.name,
        schema: DoctorAvailabilityRuleSchema,
      },
      { name: Bill.name, schema: BillSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: ServiceCatalogItem.name, schema: ServiceCatalogItemSchema },
      { name: VisitType.name, schema: VisitTypeSchema },
      { name: Encounter.name, schema: EncounterSchema },
      { name: Prescription.name, schema: PrescriptionSchema },
      { name: Document.name, schema: DocumentSchema },
      { name: User.name, schema: UserSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: MedicineCatalogItem.name, schema: MedicineCatalogItemSchema },
      { name: PortalPaymentOrder.name, schema: PortalPaymentOrderSchema },
    ]),
    PatientIdentitiesModule,
    FamilyModule,
    RecordAccessModule,
    AppointmentsModule,
    PatientsModule,
    BillingModule,
    PrescriptionsModule,
    DocumentsModule,
    StorageModule,
    AuthzModule,
    AuditModule,
    AccessLogsModule,
  ],
  controllers: [PortalAuthController, PortalController],
  providers: [
    PortalEnabledGuard,
    PortalAuthGuard,
    PortalAccessLogInterceptor,
    PortalAuditService,
    PortalScopeService,
    PortalDirectoryService,
    PortalAppointmentsService,
    PortalRecordsService,
    PortalPaymentsService,
    PortalFamilyService,
    PortalMeService,
  ],
})
export class PatientPortalModule {}
