import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from './schemas/clinic.schema';
import { Branch, BranchSchema } from './schemas/branch.schema';
import { TenancyController } from './tenancy.controller';
import { TenancyService } from './tenancy.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  controllers: [TenancyController],
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
