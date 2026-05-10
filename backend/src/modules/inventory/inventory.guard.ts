import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';
import type { AppRequest } from '../../common/types';

/**
 * Gates inventory routes behind `modules.inventory.enabled`. Clinics that
 * haven't opted into the inventory feature get 403 here even if the
 * actor has the InventoryRead/Write permission. The setting is the
 * tenant-level switch; the permission is the user-level switch — both
 * have to align for a request to land on the controller.
 */
@Injectable()
export class InventoryFeatureGuard implements CanActivate {
  constructor(
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.context) return false;
    const clinic = await this.clinicModel.findById(req.context.clinicId);
    const settings = mergeClinicSettings(clinic?.settings);
    if (!settings.modules.inventory.enabled) {
      throw new ForbiddenException(
        'Inventory module is not enabled for this clinic',
      );
    }
    return true;
  }
}
