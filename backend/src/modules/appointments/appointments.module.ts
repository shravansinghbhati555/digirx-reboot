import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { Appointment, AppointmentSchema } from './schemas/appointment.schema';
import {
  DoctorProfile,
  DoctorProfileSchema,
} from './schemas/doctor-profile.schema';
import {
  QueueCounter,
  QueueCounterSchema,
} from './schemas/queue-counter.schema';
import { AvailabilityModule } from '../availability/availability.module';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { VisitType, VisitTypeSchema } from '../visit-types/schemas/visit-type.schema';
import { Bill, BillSchema } from '../billing/schemas/bill.schema';
import { BillCounter, BillCounterSchema } from '../billing/schemas/bill-counter.schema';
import { BillNumberingService } from '../billing/bill-numbering.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: DoctorProfile.name, schema: DoctorProfileSchema },
      { name: QueueCounter.name, schema: QueueCounterSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: Patient.name, schema: PatientSchema },
      // Per-doctor visit-type catalog + the Bill collection so the
      // booking flow can auto-issue a SERVICE bill at create time. The
      // Bill model lives in BillingModule but BillingModule doesn't
      // export the Mongoose feature; re-registering here is the path
      // of least resistance and avoids a module-shape change.
      { name: VisitType.name, schema: VisitTypeSchema },
      { name: Bill.name, schema: BillSchema },
      { name: BillCounter.name, schema: BillCounterSchema },
    ]),
    // forwardRef matches the reverse edge from AvailabilityModule —
    // AppointmentsService → AvailabilityService and
    // AvailabilityService → AppointmentsService (for the close-day
    // cascade) both need to resolve.
    forwardRef(() => AvailabilityModule),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, BillNumberingService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
