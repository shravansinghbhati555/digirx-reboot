import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from './permissions';
import { Role } from './schemas/role.schema';
import { User, UserStatus } from './schemas/user.schema';

@Injectable()
export class AuthzService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
  ) {}

  async getActor(input: {
    clinicId: Types.ObjectId;
    actorUserId?: Types.ObjectId;
  }) {
    if (!input.actorUserId)
      throw new UnauthorizedException('Missing x-user-id');
    const user = await this.userModel.findOne({
      _id: input.actorUserId,
      clinicId: input.clinicId,
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.status !== UserStatus.Active)
      throw new UnauthorizedException('User disabled');

    const roles = user.roleIds?.length
      ? await this.roleModel.find({
          clinicId: input.clinicId,
          _id: { $in: user.roleIds },
        })
      : [];

    const permissions = new Set<Permission>();
    for (const r of roles) {
      for (const p of r.permissions ?? []) permissions.add(p);
    }

    return {
      user,
      roles,
      permissions: Array.from(permissions),
    };
  }
}
