import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Branch } from '../tenancy/schemas/branch.schema';

import { Role } from './schemas/role.schema';
import { User, UserStatus } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { DoctorAvailabilityRule } from '../availability/schemas/doctor-availability-rule.schema';
import { StorageService } from '../storage/storage.service';

// Roadmap 0.7: every new admin endpoint hashes at cost 12. The seed script
// still uses 10 because changing it would invalidate existing dev passwords.
const BCRYPT_COST = 12;

export type UserListItem = {
  _id: string;
  name: string;
  email?: string;
  phone?: string;
  status: string;
  roleIds: string[];
  branchIds: string[];
  defaultBranchId?: string;
  roles: { _id: string; name: string }[];
  registrationNumber?: string;
  qualifications?: string;
  faceEnrolledAt?: string;
  profileImageUrl?: string;
};


@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Role.name) private readonly roleModel: Model<Role>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(DoctorAvailabilityRule.name) private readonly ruleModel: Model<DoctorAvailabilityRule>,
    private readonly storage: StorageService,
  ) {}

  async list(clinicId: Types.ObjectId, query?: string): Promise<UserListItem[]> {
    const filter: any = { clinicId };
    if (query?.trim()) {
      filter.name = { $regex: query.trim(), $options: 'i' };
    }

    const users = await this.userModel
      .find(filter)
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

    const items = users.map((u) => this.toListItem(u, roleMap));
    // Presign profile photos so the Manager sees current pictures in the
    // user list / edit modal.
    await Promise.all(
      items.map(async (item, i) => {
        const key = (users[i] as { profileImageKey?: string }).profileImageKey;
        if (!key) return;
        item.profileImageUrl = await this.storage.presignGet({ key }).catch(() => undefined);
      }),
    );
    return items;
  }

  /**
   * Active users holding the clinic's `Doctor` role. Backs the booking
   * sheet's doctor picker, so it is gated on appointment access rather than
   * user:read — the default Doctor role has no user:read, and without this
   * a doctor booking their own patient saw an empty picker and no slots.
   */
  async listDoctors(clinicId: Types.ObjectId): Promise<UserListItem[]> {
    const doctorRoles = await this.roleModel
      .find({ clinicId, name: { $regex: '^doctor$', $options: 'i' } })
      .lean();
    if (!doctorRoles.length) return [];
    const roleMap = new Map(
      doctorRoles.map((r) => [String(r._id), { _id: String(r._id), name: r.name }]),
    );
    const users = await this.userModel
      .find({
        clinicId,
        status: UserStatus.Active,
        roleIds: { $in: doctorRoles.map((r) => r._id) },
      })
      .sort({ name: 1 })
      .lean();
    return users.map((u) => this.toListItem(u, roleMap));
  }

  async create(
    clinicId: Types.ObjectId,
    dto: CreateUserDto,
  ): Promise<UserListItem> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('name is required');

    const roleObjIds = await this.assertRolesBelongToClinic(
      clinicId,
      dto.roleIds ?? [],
    );
    const branchObjIds = await this.assertBranchesBelongToClinic(
      clinicId,
      dto.branchIds ?? [],
    );
    
    const defaultBranchObjId = dto.defaultBranchId
      ? new Types.ObjectId(dto.defaultBranchId)
      : undefined;
    if (defaultBranchObjId) {
      const inAccessList = branchObjIds.some((b) =>
        b.equals(defaultBranchObjId),
      );
      if (!inAccessList) {
        throw new BadRequestException(
          'defaultBranchId must be one of the user\'s branchIds',
        );
      }
    }

    const passwordHash = dto.password 
      ? await bcrypt.hash(dto.password, BCRYPT_COST)
      : undefined;

    let user;
    try {
      user = await this.userModel.create({
        clinicId,
        name,
        email: dto.email?.trim().toLowerCase(),
        phone: dto.phone?.trim(),
        passwordHash,
        roleIds: roleObjIds,
        branchIds: branchObjIds,
        defaultBranchId: defaultBranchObjId,
        status: UserStatus.Active,
        registrationNumber: (dto as any).registrationNumber,
        qualifications: (dto as any).qualifications,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          'A user with this email or phone already exists in this clinic',
        );
      }
      throw err;
    }

    const roles = await this.roleModel.find({ _id: { $in: roleObjIds } });
    const isDocOrManager = roles.some((r) => {
      const name = (r.name || '').toLowerCase();
      return name === 'doctor' || name === 'manager';
    });

    if (isDocOrManager) {
      await this.createDefaultAvailabilityRules(
        clinicId,
        user._id,
        branchObjIds,
      );
    }

    return await this.findOneItem(clinicId, String(user._id));
  }

  async update(
    clinicId: Types.ObjectId,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserListItem> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const user = await this.userModel.findOne({ _id: userId, clinicId });
    if (!user) throw new NotFoundException('User not found');

    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('name cannot be empty');
      user.name = trimmed;
    }
    if (dto.email !== undefined) {
      user.email = dto.email.trim().toLowerCase() || undefined;
    }
    if (dto.phone !== undefined) {
      user.phone = dto.phone.trim() || undefined;
    }
    if (dto.branchIds !== undefined) {
      user.branchIds = await this.assertBranchesBelongToClinic(
        clinicId,
        dto.branchIds,
      );
    }
    if (dto.defaultBranchId !== undefined) {
      const next = dto.defaultBranchId
        ? new Types.ObjectId(dto.defaultBranchId)
        : undefined;
      if (next) {
        const inAccessList = (user.branchIds ?? []).some((b) =>
          b.equals(next),
        );
        if (!inAccessList) {
          throw new BadRequestException(
            'defaultBranchId must be one of the user\'s branchIds',
          );
        }
      }
      user.defaultBranchId = next;
    }
    if (dto.status !== undefined) {
      user.status = dto.status;
    }

    try {
      await user.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(
          'A user with this email or phone already exists in this clinic',
        );
      }
      throw err;
    }

    return await this.findOneItem(clinicId, String(user._id));
  }

  async resetPassword(
    clinicId: Types.ObjectId,
    userId: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const result = await this.userModel.updateOne(
      { _id: userId, clinicId },
      { $set: { passwordHash } },
    );
    if (!result.matchedCount) {
      throw new NotFoundException('User not found');
    }
    return { ok: true };
  }

  async updateRoles(
    clinicId: Types.ObjectId,
    userId: string,
    roleIds: string[],
  ): Promise<UserListItem> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('User not found');
    }

    const objIds = await this.assertRolesBelongToClinic(clinicId, roleIds);

    const user = await this.userModel.findOne({ _id: userId, clinicId });
    if (!user) throw new NotFoundException('User not found');

    user.roleIds = objIds;
    await user.save();

    return await this.findOneItem(clinicId, String(user._id));
  }

  // --- private helpers ----------------------------------------------------

  private async assertRolesBelongToClinic(
    clinicId: Types.ObjectId,
    roleIds: string[],
  ): Promise<Types.ObjectId[]> {
    const objIds: Types.ObjectId[] = [];
    for (const id of roleIds) {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid role id: ${id}`);
      }
      objIds.push(new Types.ObjectId(id));
    }
    if (!objIds.length) return objIds;
    const found = await this.roleModel.find({
      clinicId,
      _id: { $in: objIds },
    });
    if (found.length !== new Set(roleIds).size) {
      throw new BadRequestException(
        'One or more roles do not belong to this clinic',
      );
    }
    return objIds;
  }

  private async assertBranchesBelongToClinic(
    clinicId: Types.ObjectId,
    branchIds: string[],
  ): Promise<Types.ObjectId[]> {
    const objIds: Types.ObjectId[] = [];
    for (const id of branchIds) {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid branch id: ${id}`);
      }
      objIds.push(new Types.ObjectId(id));
    }
    if (!objIds.length) return objIds;
    const found = await this.branchModel.find({
      clinicId,
      _id: { $in: objIds },
    });
    if (found.length !== new Set(branchIds).size) {
      throw new BadRequestException(
        'One or more branches do not belong to this clinic',
      );
    }
    return objIds;
  }

  private async findOneItem(
    clinicId: Types.ObjectId,
    userId: string,
  ): Promise<UserListItem> {
    const user = await this.userModel
      .findOne({ _id: userId, clinicId })
      .lean();
    if (!user) throw new NotFoundException('User not found');

    const roleIds = (user.roleIds ?? []).map(String);
    const roles = roleIds.length
      ? await this.roleModel
          .find({ clinicId, _id: { $in: roleIds } })
          .lean()
      : [];
    const roleMap = new Map(
      roles.map((r) => [String(r._id), { _id: String(r._id), name: r.name }]),
    );
    return this.toListItem(user, roleMap);
  }

  private toListItem(
    u: Record<string, any>,
    roleMap: Map<string, { _id: string; name: string }>,
  ): UserListItem {
    return {
      _id: String(u._id),
      name: u.name,
      email: u.email,
      phone: u.phone,
      status: u.status,
      roleIds: (u.roleIds ?? []).map(String),
      branchIds: (u.branchIds ?? []).map(String),
      defaultBranchId: u.defaultBranchId ? String(u.defaultBranchId) : undefined,
      roles: (u.roleIds ?? [])
        .map((rid: any) => roleMap.get(String(rid)))
        .filter((r: unknown): r is { _id: string; name: string } => !!r),
      registrationNumber: u.registrationNumber,
      qualifications: u.qualifications,
      faceEnrolledAt: u.faceEnrolledAt
        ? new Date(u.faceEnrolledAt).toISOString()
        : undefined,
    };
  }

  private async createDefaultAvailabilityRules(
    clinicId: Types.ObjectId,
    userId: Types.ObjectId,
    branchIds: Types.ObjectId[],
  ) {
    // Weekdays Monday (1) through Friday (5)
    // 9:00 AM (540 mins) to 5:00 PM (1020 mins)
    const weekdays = [1, 2, 3, 4, 5];
    const rulesToInsert = [];

    for (const branchId of branchIds) {
      for (const weekday of weekdays) {
        rulesToInsert.push({
          clinicId,
          branchId,
          doctorUserId: userId,
          weekday,
          windows: [{ startMinutes: 540, endMinutes: 1020 }],
          slotMinutes: 15,
          active: true,
        });
      }
    }

    if (rulesToInsert.length > 0) {
      try {
        await this.ruleModel.insertMany(rulesToInsert, { ordered: false });
      } catch (err) {
        this.logger.error('Error seeding default availability rules:', err);
      }
    }
  }
}
