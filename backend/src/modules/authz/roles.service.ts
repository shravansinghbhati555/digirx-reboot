import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Permission } from './permissions';
import { Role, type RoleDocument } from './schemas/role.schema';

const ADMIN_ROLE_NAME = 'Admin';
const ALL_PERMISSIONS = new Set<string>(Object.values(Permission));

function validatePermissionList(permissions: string[]): Permission[] {
  const unknown = permissions.filter((p) => !ALL_PERMISSIONS.has(p));
  if (unknown.length) {
    throw new BadRequestException(
      `Unknown permission(s): ${unknown.join(', ')}`,
    );
  }
  // De-duplicate while preserving order so callers can read back exactly what
  // the role will store.
  return Array.from(new Set(permissions)) as Permission[];
}

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

  async create(clinicId: Types.ObjectId, name: string, permissions: string[]) {
    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('name is required');
    if (trimmed === ADMIN_ROLE_NAME) {
      // The seed script provisions Admin with the full enum; preventing
      // creation here keeps the "Admin is immutable" invariant intact.
      throw new BadRequestException(
        `'${ADMIN_ROLE_NAME}' is reserved and cannot be created`,
      );
    }
    const validated = validatePermissionList(permissions);

    // Mongoose's `create()` overloads include an array form, which makes the
    // inferred return type a union; pin it to a single doc explicitly.
    let role: RoleDocument;
    try {
      role = (await this.roleModel.create({
        clinicId,
        name: trimmed,
        permissions: validated,
      })) as RoleDocument;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          `A role named '${trimmed}' already exists in this clinic`,
        );
      }
      throw err;
    }

    return {
      _id: String(role._id),
      name: role.name,
      permissions: role.permissions,
      immutable: false,
    };
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

    role.permissions = validatePermissionList(permissions);
    await role.save();

    return {
      _id: String(role._id),
      name: role.name,
      permissions: role.permissions,
      immutable: false,
    };
  }
}
