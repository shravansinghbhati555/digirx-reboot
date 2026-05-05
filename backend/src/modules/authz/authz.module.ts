import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthzService } from './authz.service';
import { RolesService } from './roles.service';
import { UsersService } from './users.service';
import { Role, RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';
import { MeController } from './me.controller';
import { RolesController } from './roles.controller';
import { UsersController } from './users.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  providers: [AuthzService, RolesService, UsersService],
  controllers: [MeController, RolesController, UsersController],
  exports: [AuthzService],
})
export class AuthzModule {}
