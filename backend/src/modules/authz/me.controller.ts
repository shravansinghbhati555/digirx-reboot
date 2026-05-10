import { Controller, Get, Req } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { AuthzService } from './authz.service';
import { RequirePermissions } from './require-permissions.decorator';
import { Clinic } from '../tenancy/schemas/clinic.schema';

@Controller()
export class MeController {
  constructor(
    private readonly authz: AuthzService,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
  ) {}

  @Get('me')
  @RequirePermissions()
  async me(@Req() req: AppRequest) {
    const [actor, clinic] = await Promise.all([
      this.authz.getActor({
        clinicId: req.context!.clinicId,
        actorUserId: req.context!.actorUserId,
      }),
      this.clinicModel.findById(req.context!.clinicId),
    ]);

    return {
      clinicId: req.context!.clinicId,
      branchId: req.context!.branchId,
      // Carry the clinic profile basics so the FE can default money formatting,
      // date formatting, and locale without an extra round-trip.
      clinic: clinic
        ? {
            _id: clinic._id,
            name: clinic.name,
            currency: clinic.currency,
            timezone: clinic.timezone,
            countryCode: clinic.countryCode,
          }
        : null,
      user: actor.user,
      roles: actor.roles,
      permissions: actor.permissions,
    };
  }
}
