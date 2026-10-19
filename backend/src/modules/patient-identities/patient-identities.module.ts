import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import {
  PatientAccount,
  PatientAccountSchema,
} from './schemas/patient-account.schema';
import { PatientLink, PatientLinkSchema } from './schemas/patient-link.schema';
import { PortalOtp, PortalOtpSchema } from './schemas/portal-otp.schema';
import {
  PortalSession,
  PortalSessionSchema,
} from './schemas/portal-session.schema';
import { PatientIdentitiesService } from './patient-identities.service';
import { PortalOtpService } from './portal-otp.service';
import { PortalSessionService } from './portal-session.service';

/**
 * Global patient identity for the portal: accounts, links to clinic-specific
 * Patient records, OTP login and refresh sessions. Reads clinic Patient rows
 * but never writes them.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PatientAccount.name, schema: PatientAccountSchema },
      { name: PatientLink.name, schema: PatientLinkSchema },
      { name: PortalOtp.name, schema: PortalOtpSchema },
      { name: PortalSession.name, schema: PortalSessionSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
    // JwtService (registered without a default secret; every call passes
    // the portal secret explicitly).
    AuthModule,
  ],
  providers: [PatientIdentitiesService, PortalOtpService, PortalSessionService],
  exports: [PatientIdentitiesService, PortalOtpService, PortalSessionService],
})
export class PatientIdentitiesModule {}
