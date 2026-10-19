import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  FamilyConnection,
  FamilyConnectionSchema,
} from './schemas/family-connection.schema';
import { FamilyGrant, FamilyGrantSchema } from './schemas/family-grant.schema';
import { FamilyService } from './family.service';

/** Family connections between portal accounts and the per-capability grants between them. */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FamilyConnection.name, schema: FamilyConnectionSchema },
      { name: FamilyGrant.name, schema: FamilyGrantSchema },
    ]),
  ],
  providers: [FamilyService],
  exports: [FamilyService],
})
export class FamilyModule {}
