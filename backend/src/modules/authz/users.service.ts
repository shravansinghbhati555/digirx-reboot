import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Role } from './schemas/role.schema';
import { User } from './schemas/user.schema';

export type UserListItem = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  roleIds: string[];
  roles: { _id: string; name: string }[];
  registrationNumber?: string;
  qualifications?: string;
};

export type CreateUserDto = {
  name: string;
  email?: string;
  phone?: string;
  password?: string;
  registrationNumber?: string;
  qualifications?: string;
  roleIds?: string[];
  branchIds?: string[];
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
  ) {}

  async list(clinicId: Types.ObjectId): Promise<UserListItem[]> {
    const users = await this.userModel
      .find({ clinicId })
      .sort({ name: 1 })
      .lean();

    const allRoleIds = Array.from(
      new Set(users.flatMap((u) => (u.roleIds ?? []).map(String))),
    );
    const roles = allRoleIds.length
      ? await this.roleModel
          .find({ clinicId, _id: { $in: allRoleIds } })
          .lean()
      : [];
    const roleMap = new Map(
      roles.map((r) => [String(r._id), { _id: String(r._id), name: r.name }]),
    );

    return users.map((u) => ({
      _id: String(u._id),
      name: u.name,
      email: u.email,
      phone: u.phone,
      status: u.status,
      roleIds: (u.roleIds ?? []).map(String),
      roles: (u.roleIds ?? [])
        .map((rid) => roleMap.get(String(rid)))
        .filter((r): r is { _id: string; name: string } => !!r),
      registrationNumber: u.registrationNumber,
      qualifications: u.qualifications,
    }));
  }

  async create(
    clinicId: Types.ObjectId,
    dto: CreateUserDto,
  ): Promise<UserListItem> {
    const { password, roleIds, ...rest } = dto;

    const user = new this.userModel({
      ...rest,
      clinicId,
      status: 'ACTIVE',
    });

    if (password) {
      user.passwordHash = await bcrypt.hash(password, 10);
    }

    if (roleIds?.length) {
      user.roleIds = roleIds.map((id) => new Types.ObjectId(id));
    }

    if (dto.branchIds?.length) {
      user.branchIds = dto.branchIds.map((id) => new Types.ObjectId(id));
    }

    await user.save();
    
    const [item] = await this.list(clinicId).then((rows) =>
      rows.filter((r) => r._id === String(user._id)),
    );
    return item;
  }

  async updateRoles(
    clinicId: Types.ObjectId,
    userId: string,
    roleIds: string[],
  ): Promise<UserListItem> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    const objIds: Types.ObjectId[] = [];
    for (const id of roleIds) {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid role id: ${id}`);
      }
      objIds.push(new Types.ObjectId(id));
    }

    if (objIds.length) {
      const found = await this.roleModel.find({
        clinicId,
        _id: { $in: objIds },
      });
      if (found.length !== new Set(roleIds).size) {
        throw new BadRequestException(
          'One or more roles do not belong to this clinic',
        );
      }
    }

    const user = await this.userModel.findOne({ _id: userId, clinicId });
    if (!user) throw new NotFoundException('User not found');

    user.roleIds = objIds;
    await user.save();

    // Return populated row in the same shape as list().
    const [item] = await this.list(clinicId).then((rows) =>
      rows.filter((r) => r._id === String(user._id)),
    );
    if (!item) throw new NotFoundException('User not found after update');
    return item;
  }
}
