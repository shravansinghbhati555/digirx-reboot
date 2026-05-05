import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from './permissions';
import { Role } from './schemas/role.schema';

const ADMIN_ROLE_NAME = 'Admin';
const ALL_PERMISSIONS = new Set<string>(Object.values(Permission));

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
  ) {}

  async list(clinicId: Types.ObjectId) {
    const roles = await this.roleModel
      .find({ clinicId })
      .sort({ name: 1 })
      .lean();
    return roles.map((r) => ({
      _id: String(r._id),
      name: r.name,
      permissions: r.permissions ?? [],
      immutable: r.name === ADMIN_ROLE_NAME,
    }));
  }

  async updatePermissions(
    clinicId: Types.ObjectId,
    id: string,
    permissions: string[],
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Role not found');
    }
    const role = await this.roleModel.findOne({ _id: id, clinicId });
    if (!role) throw new NotFoundException('Role not found');

    if (role.name === ADMIN_ROLE_NAME) {
      throw new ForbiddenException('Admin role permissions cannot be edited');
    }

    const unknown = permissions.filter((p) => !ALL_PERMISSIONS.has(p));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown permission(s): ${unknown.join(', ')}`,
      );
    }

    // De-duplicate while preserving order.
    role.permissions = Array.from(new Set(permissions)) as Permission[];
    await role.save();

    return {
      _id: String(role._id),
      name: role.name,
      permissions: role.permissions,
      immutable: false,
    };
  }
}
