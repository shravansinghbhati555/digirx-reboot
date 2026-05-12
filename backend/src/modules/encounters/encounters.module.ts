import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EncountersController } from './encounters.controller';
import { EncountersService } from './encounters.service';
import { Encounter, EncounterSchema } from './schemas/encounter.schema';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';

import { EncounterCounter, EncounterCounterSchema } from './schemas/encounter-counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Encounter.name, schema: EncounterSchema },
      { name: Appointment.name, schema: AppointmentSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: EncounterCounter.name, schema: EncounterCounterSchema },
    ]),
  ],
  controllers: [EncountersController],
  providers: [EncountersService],
  exports: [EncountersService],
})
export class EncountersModule {}
