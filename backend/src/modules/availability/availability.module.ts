import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { DoctorAvailabilityRule, DoctorAvailabilityRuleSchema } from './schemas/doctor-availability-rule.schema';
import {
  DoctorAvailabilityOverride,
  DoctorAvailabilityOverrideSchema,
} from './schemas/doctor-availability-override.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DoctorAvailabilityRule.name, schema: DoctorAvailabilityRuleSchema },
      { name: DoctorAvailabilityOverride.name, schema: DoctorAvailabilityOverrideSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
  ],
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}

