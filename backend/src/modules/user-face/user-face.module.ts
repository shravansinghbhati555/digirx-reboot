import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FaceClient } from '../face/face-client.service';
import { User, UserSchema } from '../authz/schemas/user.schema';
import {
  FaceEmbedding,
  FaceEmbeddingSchema,
} from '../face/schemas/face-embedding.schema';
import {
  UserFaceEmbedding,
  UserFaceEmbeddingSchema,
} from './schemas/user-face-embedding.schema';
import { StorageModule } from '../storage/storage.module';
import { UserFaceService } from './user-face.service';
import { LocalUserFaceProvider } from './providers/local-user-face.provider';
import { AzureUserFaceProvider } from './providers/azure-user-face.provider';

/**
 * Self-contained staff face-login module. Provides its own FaceClient
 * instance (stateless HTTP wrapper around face-svc) so it doesn't have
 * to import the patient FaceModule. Exported for AuthModule (login) and
 * AuthzModule (enroll/remove via Users screen).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: UserFaceEmbedding.name, schema: UserFaceEmbeddingSchema },
      { name: User.name, schema: UserSchema },
      // Read-only access to the patient gallery for the enroll-time
      // duplicate-face check (a staff face must not also be a patient).
      { name: FaceEmbedding.name, schema: FaceEmbeddingSchema },
    ]),
    StorageModule,
  ],
  providers: [UserFaceService, FaceClient, LocalUserFaceProvider, AzureUserFaceProvider],
  exports: [UserFaceService],
})
export class UserFaceModule {}
