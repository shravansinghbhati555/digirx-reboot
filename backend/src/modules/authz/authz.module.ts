import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthzService } from './authz.service';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';
import { Role, RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { DoctorAvailabilityRule, DoctorAvailabilityRuleSchema } from '../availability/schemas/doctor-availability-rule.schema';
import { MeController } from './me.controller';
import { RolesController } from './roles.controller';
import { UsersController } from './users.controller';
import { UserFaceModule } from '../user-face/user-face.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      // Needed by UsersService to validate that branchIds passed on create /
      // update actually belong to the requesting tenant.
      { name: Branch.name, schema: BranchSchema },
      // /me reads the clinic profile (currency, timezone) so the FE can
      // bootstrap formatting without an extra request.
      { name: Clinic.name, schema: ClinicSchema },
      { name: DoctorAvailabilityRule.name, schema: DoctorAvailabilityRuleSchema },
    ]),
    // UsersController enrolls / removes staff face templates.
    UserFaceModule,
    // Presign user profile photos (/me, user list, manager upload).
    StorageModule,
  ],
  providers: [AuthzService, RolesService, UsersService],
  controllers: [MeController, RolesController, UsersController],
  exports: [AuthzService],
})
export class AuthzModule {}
