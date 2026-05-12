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
    ]),
    // forwardRef matches the reverse edge from AvailabilityModule —
    // AppointmentsService → AvailabilityService and
    // AvailabilityService → AppointmentsService (for the close-day
    // cascade) both need to resolve.
    forwardRef(() => AvailabilityModule),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
