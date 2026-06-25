import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FaceController } from './face.controller';
import { FaceService } from './face.service';
import { FaceClient } from './face-client.service';
import { LocalFaceProvider } from './providers/local-face.provider';
import { AzureFaceProvider } from './providers/azure-face.provider';
import {
  FaceEmbedding,
  FaceEmbeddingSchema,
} from './schemas/face-embedding.schema';
import {
  UserFaceEmbedding,
  UserFaceEmbeddingSchema,
} from '../user-face/schemas/user-face-embedding.schema';
import { Patient, PatientSchema } from '../patients/schemas/patient.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { AuthzModule } from '../authz/authz.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FaceEmbedding.name, schema: FaceEmbeddingSchema },
      // Read-only access to the staff gallery for the enroll-time
      // duplicate-face check (a patient face must not also be staff).
      { name: UserFaceEmbedding.name, schema: UserFaceEmbeddingSchema },
      { name: Patient.name, schema: PatientSchema },
      { name: Clinic.name, schema: ClinicSchema },
    ]),
    AuthzModule,
    StorageModule,
  ],
  controllers: [FaceController],
  // Both providers are always constructed; FaceService picks the
  // active one per request via the FACE_PROVIDER env var.
  providers: [FaceService, FaceClient, LocalFaceProvider, AzureFaceProvider],
  exports: [FaceService],
})
export class FaceModule {}
