import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FaceClient } from '../face/face-client.service';
import { User, UserSchema } from '../authz/schemas/user.schema';
import {
  UserFaceEmbedding,
  UserFaceEmbeddingSchema,
} from './schemas/user-face-embedding.schema';
import { UserFaceService } from './user-face.service';

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
    ]),
  ],
  providers: [UserFaceService, FaceClient],
  exports: [UserFaceService],
})
export class UserFaceModule {}
