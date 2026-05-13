import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { AuthzModule } from '../authz/authz.module';
import { VisitTypesController } from './visit-types.controller';
import { VisitTypesService } from './visit-types.service';
import { VisitType, VisitTypeSchema } from './schemas/visit-type.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VisitType.name, schema: VisitTypeSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
    AuthzModule,
  ],
  controllers: [VisitTypesController],
  providers: [VisitTypesService],
  exports: [VisitTypesService, MongooseModule],
})
export class VisitTypesModule {}
