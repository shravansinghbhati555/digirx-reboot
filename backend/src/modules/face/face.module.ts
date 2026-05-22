import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FaceController } from './face.controller';
import { FaceService } from './face.service';
import { FaceClient } from './face-client.service';
import {
  FaceEmbedding,
  FaceEmbeddingSchema,
} from './schemas/face-embedding.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { AuthzModule } from '../authz/authz.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FaceEmbedding.name, schema: FaceEmbeddingSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
    AuthzModule,
    StorageModule,
  ],
  controllers: [FaceController],
  providers: [FaceService, FaceClient],
  exports: [FaceService],
})
export class FaceModule {}
