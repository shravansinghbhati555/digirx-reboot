import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Appointment.name, schema: AppointmentSchema },
      { name: DoctorProfile.name, schema: DoctorProfileSchema },
      { name: QueueCounter.name, schema: QueueCounterSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
    AvailabilityModule,
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
})
export class AppointmentsModule {}
