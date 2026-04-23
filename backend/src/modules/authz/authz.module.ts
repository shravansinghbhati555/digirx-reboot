import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthzService } from './authz.service';
import { Role, RoleSchema } from './schemas/role.schema';
import { User, UserSchema } from './schemas/user.schema';
import { MeController } from './me.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  providers: [AuthzService],
  controllers: [MeController],
  exports: [AuthzService],
})
export class AuthzModule {}
