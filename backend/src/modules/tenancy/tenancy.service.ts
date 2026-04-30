import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Clinic } from './schemas/clinic.schema';
import { Branch } from './schemas/branch.schema';
import {
  mergeClinicSettings,
  type ClinicSettingsV1,
} from './clinic-settings.types';
import { PatchClinicSettingsDto } from './dto/patch-clinic-settings.dto';

@Injectable()
export class TenancyService {
  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
  ) {}

  async getClinic(clinicId: Types.ObjectId) {
    const clinic = await this.clinicModel.findById(clinicId);
    if (!clinic) throw new NotFoundException('Clinic not found');
    return clinic;
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

    const next: ClinicSettingsV1 = {
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
      },
    };

    clinic.settings = next as any;
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
}
