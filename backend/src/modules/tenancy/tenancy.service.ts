import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import { Model, Types } from 'mongoose';
import { Clinic } from './schemas/clinic.schema';
import { Branch } from './schemas/branch.schema';
import { User } from '../authz/schemas/user.schema';
import {
  mergeClinicSettings,
  type ClinicSettingsV1,
} from './clinic-settings.types';
import { PatchClinicSettingsDto } from './dto/patch-clinic-settings.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class TenancyService {
  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async getClinic(clinicId: Types.ObjectId) {
    const clinic = await this.clinicModel.findById(clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    return clinic;
  }

  /**
   * Validates that the route's :id param matches the request's authenticated
   * tenant. Mismatch → 404 (don't leak existence of other clinics).
   */
  assertTenantMatch(pathId: string, ctxClinicId: Types.ObjectId): Types.ObjectId {
    if (!Types.ObjectId.isValid(pathId)) {
      throw new NotFoundException('Clinic not found');
    }
    const parsed = new Types.ObjectId(pathId);
    if (!parsed.equals(ctxClinicId)) {
      throw new NotFoundException('Clinic not found');
    }
    return parsed;
  }

  async getSettings(clinicId: Types.ObjectId) {
    const clinic = await this.getClinic(clinicId);
    const settings = mergeClinicSettings(clinic.settings);
    return {
      clinic: {
        _id: clinic._id,
        name: clinic.name,
        countryCode: clinic.countryCode,
        timezone: clinic.timezone,
        currency: clinic.currency,
        phoneCountryCode: clinic.phoneCountryCode,
      },
      settings,
    };
  }

  async patchSettings(clinicId: Types.ObjectId, patch: PatchClinicSettingsDto) {
    const clinic = await this.getClinic(clinicId);
    const current = mergeClinicSettings(clinic.settings);

    // Deep-merge each settings sub-tree: a missing key on the patch leaves the
    // current value untouched. `mergeClinicSettings` then re-coerces the result
    // so the stored shape is always canonical.
    const nextRaw: ClinicSettingsV1 = {
      appointments: {
        mode: patch.appointments?.mode ?? current.appointments.mode,
        slotMinutesDefault:
          patch.appointments?.slotMinutesDefault ??
          current.appointments.slotMinutesDefault,
      },
      modules: {
        inventory: {
          enabled:
            patch.modules?.inventory?.enabled ??
            current.modules.inventory.enabled,
        },
        notifications: {
          sms: {
            enabled:
              patch.modules?.notifications?.sms?.enabled ??
              current.modules.notifications.sms.enabled,
          },
          whatsapp: {
            enabled:
              patch.modules?.notifications?.whatsapp?.enabled ??
              current.modules.notifications.whatsapp.enabled,
          },
        },
      },
      branding: {
        displayName:
          patch.branding && 'displayName' in patch.branding
            ? (patch.branding.displayName ?? null)
            : current.branding.displayName,
        logoUrl:
          patch.branding && 'logoUrl' in patch.branding
            ? (patch.branding.logoUrl ?? null)
            : current.branding.logoUrl,
        primaryColor:
          patch.branding && 'primaryColor' in patch.branding
            ? (patch.branding.primaryColor ?? null)
            : current.branding.primaryColor,
      },
    };

    clinic.settings = mergeClinicSettings(nextRaw) as any;

    // Top-level clinic profile fields (live on the Clinic doc, not settings).
    if (patch.name !== undefined) clinic.name = patch.name;
    if (patch.timezone !== undefined) {
      if (!isValidIanaZone(patch.timezone)) {
        throw new BadRequestException(`Invalid IANA timezone: ${patch.timezone}`);
      }
      clinic.timezone = patch.timezone;
    }
    if (patch.currency !== undefined) clinic.currency = patch.currency.toUpperCase();

    await clinic.save();
    return await this.getSettings(clinicId);
  }

  async searchClinics(query: string) {
    const filter = query
      ? { name: { $regex: query, $options: 'i' } }
      : {};
    const clinics = await this.clinicModel.find(filter).limit(10).exec();
    return clinics.map((c) => ({
      id: c._id,
      name: c.name,
      countryCode: c.countryCode,
      timezone: c.timezone,
    }));
  }

  async listBranches(clinicId: string) {
    const branches = await this.branchModel.find({ clinicId: new Types.ObjectId(clinicId) }).exec();
    return branches.map((b) => ({
      id: b._id,
      name: b.name,
      address: b.address,
    }));
  }

  /** Detailed list for the admin Settings UI. */
  async listBranchesAdmin(clinicId: Types.ObjectId) {
    const branches = await this.branchModel.find({ clinicId }).sort({ name: 1 }).exec();

    // Doctor counts per branch — single aggregation rather than N queries.
    const counts = await this.userModel.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { clinicId, branchIds: { $in: branches.map((b) => b._id) } } },
      { $unwind: '$branchIds' },
      { $match: { branchIds: { $in: branches.map((b) => b._id) } } },
      { $group: { _id: '$branchIds', count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c) => [c._id.toHexString(), c.count]));

    return branches.map((b) => this.toBranchDto(b, countMap.get(b._id.toHexString()) ?? 0));
  }

  async createBranch(clinicId: Types.ObjectId, body: CreateBranchDto) {
    const existing = await this.branchModel.findOne({ clinicId, name: body.name.trim() });
    if (existing) {
      throw new BadRequestException(`Branch "${body.name}" already exists`);
    }

    const workingHours: Record<string, string> = {};
    if (body.open) workingHours.open = body.open;
    if (body.close) workingHours.close = body.close;

    const created = await this.branchModel.create({
      clinicId,
      name: body.name.trim(),
      addressLine: body.addressLine?.trim() || undefined,
      phone: body.phone?.trim() || undefined,
      workingHours: Object.keys(workingHours).length ? workingHours : undefined,
      slotsPerDay: body.slotsPerDay,
      active: body.active ?? true,
    });
    return this.toBranchDto(created, 0);
  }

  async updateBranch(clinicId: Types.ObjectId, branchId: string, body: UpdateBranchDto) {
    if (!Types.ObjectId.isValid(branchId)) {
      throw new NotFoundException('Branch not found');
    }
    const branch = await this.branchModel.findOne({ _id: new Types.ObjectId(branchId), clinicId });
    if (!branch) throw new NotFoundException('Branch not found');

    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (trimmed !== branch.name) {
        const dup = await this.branchModel.findOne({ clinicId, name: trimmed, _id: { $ne: branch._id } });
        if (dup) throw new BadRequestException(`Branch "${trimmed}" already exists`);
        branch.name = trimmed;
      }
    }
    if (body.addressLine !== undefined) branch.addressLine = body.addressLine.trim() || undefined;
    if (body.phone !== undefined) branch.phone = body.phone.trim() || undefined;
    if (body.open !== undefined || body.close !== undefined) {
      const wh = (branch.workingHours ?? {}) as { open?: string; close?: string };
      if (body.open !== undefined) wh.open = body.open || undefined;
      if (body.close !== undefined) wh.close = body.close || undefined;
      branch.workingHours = wh;
    }
    if (body.slotsPerDay !== undefined) branch.slotsPerDay = body.slotsPerDay;
    if (body.active !== undefined) branch.active = body.active;

    await branch.save();
    const docCount = await this.userModel.countDocuments({ clinicId, branchIds: branch._id });
    return this.toBranchDto(branch, docCount);
  }

  private toBranchDto(b: Branch & { _id: Types.ObjectId }, doctorCount: number) {
    const wh = (b.workingHours ?? {}) as { open?: string; close?: string };
    return {
      _id: b._id,
      name: b.name,
      addressLine: b.addressLine ?? legacyAddressLine(b.address),
      phone: b.phone,
      open: wh.open,
      close: wh.close,
      slotsPerDay: b.slotsPerDay,
      active: b.active,
      doctorCount,
    };
  }
}

function legacyAddressLine(addr?: Record<string, unknown>): string | undefined {
  if (!addr) return undefined;
  const street = typeof addr.street === 'string' ? addr.street : '';
  const city = typeof addr.city === 'string' ? addr.city : '';
  const zip = typeof addr.zip === 'string' ? addr.zip : '';
  const left = [street, city].filter(Boolean).join(', ');
  return zip ? (left ? `${left} — ${zip}` : zip) : left || undefined;
}

function isValidIanaZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}
