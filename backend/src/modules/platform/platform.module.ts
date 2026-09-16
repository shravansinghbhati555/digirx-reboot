import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { User, UserSchema } from '../authz/schemas/user.schema';
import { Session, SessionSchema } from '../auth/schemas/session.schema';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
  ],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAdminGuard],
  // The leads inbox reuses the same staff-only gate.
  exports: [PlatformAdminGuard, MongooseModule],
})
export class PlatformModule {}
