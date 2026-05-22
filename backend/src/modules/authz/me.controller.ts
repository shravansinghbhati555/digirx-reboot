import { Controller, Get, Req } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { AuthzService } from './authz.service';
import { RequirePermissions } from './require-permissions.decorator';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';

@Controller()
export class MeController {
  constructor(
    private readonly authz: AuthzService,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
  ) {}

  @Get('me')
  @RequirePermissions()
  async me(@Req() req: AppRequest) {
    const [actor, clinic, branch] = await Promise.all([
      this.authz.getActor({
        clinicId: req.context!.clinicId,
        actorUserId: req.context!.actorUserId,
      }),
      this.clinicModel.findById(req.context!.clinicId),
      req.context!.branchId
        ? this.branchModel.findById(req.context!.branchId).select({ name: 1 })
        : Promise.resolve(null),
    ]);

    // Slim view of the per-clinic feature toggles the FE needs to render
    // optional UI. Sent on /me so the app doesn't need a second round-
    // trip just to learn whether (e.g.) face recognition is enabled.
    const settings = clinic ? mergeClinicSettings(clinic.settings) : null;
    const features = settings
      ? {
          faceRecognition: settings.modules.faceRecognition.enabled,
          inventory: settings.modules.inventory.enabled,
          // 'TIME' | 'QUEUE' | 'BOTH' — drives whether the BookSheet
          // shows the kind toggle and which option is default.
          appointmentMode: settings.appointments.mode,
        }
      : null;

    return {
      clinicId: req.context!.clinicId,
      branchId: req.context!.branchId,
      // Carry the branch's display name so the FE sidebar / chip can
      // show "Main Branch" instead of falling back to a slice of the
      // raw ObjectId hex. Only populated when the user is signed in
      // with a branch context; admins / managers without a default
      // branch get `null`.
      branch: branch ? { _id: branch._id, name: branch.name } : null,
      // Carry the clinic profile basics so the FE can default money formatting,
      // date formatting, and locale without an extra round-trip. Branding is
      // included so the FE-side prescription printer can render the clinic's
      // display name / logo / primary color without a settings fetch.
      clinic: clinic
        ? {
            _id: clinic._id,
            name: clinic.name,
            currency: clinic.currency,
            timezone: clinic.timezone,
            countryCode: clinic.countryCode,
            branding: settings
              ? {
                  displayName: settings.branding.displayName,
                  logoUrl: settings.branding.logoUrl,
                  primaryColor: settings.branding.primaryColor,
                }
              : null,
          }
        : null,
      features,
      user: actor.user,
      roles: actor.roles,
      permissions: actor.permissions,
    };
  }
}
