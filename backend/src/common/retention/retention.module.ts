import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from '../../modules/tenancy/schemas/clinic.schema';
import { RetentionService } from './retention.service';

/**
 * Marked `@Global()` so audit + access-logs (and any future log-shaped
 * collection) can inject `RetentionService` without each importing this
 * module.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Clinic.name, schema: ClinicSchema }]),
  ],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
