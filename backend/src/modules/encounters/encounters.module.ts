import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EncountersController } from './encounters.controller';
import { EncountersService } from './encounters.service';
import { Encounter, EncounterSchema } from './schemas/encounter.schema';
import {
  Appointment,
  AppointmentSchema,
} from '../appointments/schemas/appointment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Encounter.name, schema: EncounterSchema },
      { name: Appointment.name, schema: AppointmentSchema },
    ]),
  ],
  controllers: [EncountersController],
  providers: [EncountersService],
  exports: [EncountersService],
})
export class EncountersModule {}
