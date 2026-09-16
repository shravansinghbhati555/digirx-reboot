import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from './schemas/lead.schema';
import { LeadsController, PlatformLeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { PlatformModule } from '../platform/platform.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Lead.name, schema: LeadSchema }]),
    // For PlatformAdminGuard, which gates the staff-facing inbox.
    PlatformModule,
  ],
  controllers: [LeadsController, PlatformLeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
