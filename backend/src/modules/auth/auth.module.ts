import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { User, UserSchema } from '../authz/schemas/user.schema';
import { Role, RoleSchema } from '../authz/schemas/role.schema';
import { Clinic, ClinicSchema } from '../tenancy/schemas/clinic.schema';
import { Branch, BranchSchema } from '../tenancy/schemas/branch.schema';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtContextGuard } from './jwt.guard';
import { Session, SessionSchema } from './schemas/session.schema';
import { UserFaceModule } from '../user-face/user-face.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
      { name: Clinic.name, schema: ClinicSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    JwtModule.register({}),
    UserFaceModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtContextGuard,
    {
      provide: APP_GUARD,
      useClass: JwtContextGuard,
    },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
