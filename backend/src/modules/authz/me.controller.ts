import { BadRequestException, Body, Controller, Get, Patch, Req } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { AuthzService } from './authz.service';
import { RequirePermissions } from './require-permissions.decorator';
import { Clinic } from '../tenancy/schemas/clinic.schema';
import { Branch } from '../tenancy/schemas/branch.schema';
import { User } from './schemas/user.schema';
import { StorageService } from '../storage/storage.service';
import { mergeClinicSettings } from '../tenancy/clinic-settings.types';

// Reject obviously-invalid IANA zones cheaply before persisting.
function isValidIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@Controller()
export class MeController {
  constructor(
    private readonly authz: AuthzService,
    @InjectModel(Clinic.name) private readonly clinicModel: Model<Clinic>,
    @InjectModel(Branch.name) private readonly branchModel: Model<Branch>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly storage: StorageService,
  ) {}

  // Self-service: any authenticated user sets their OWN display timezone
  // (or clears it to fall back to the clinic timezone). This does NOT
  // touch the clinic's authoritative timezone.
  @Patch('me/timezone')
  @RequirePermissions()
  async setMyTimezone(@Req() req: AppRequest, @Body('timezone') timezone?: string | null) {
    const tz = (timezone ?? '').trim();
    if (tz && !isValidIanaZone(tz)) {
      throw new BadRequestException(`Invalid timezone: ${tz}`);
    }
    await this.userModel.updateOne(
      { _id: req.context!.actorUserId, clinicId: req.context!.clinicId },
      tz ? { $set: { displayTimezone: tz } } : { $unset: { displayTimezone: '' } },
    );
    return { displayTimezone: tz || null };
  }

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
        ? this.branchModel.findById(req.context!.branchId).select({ name: 1, upiId: 1, upiQrUrl: 1 })
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
      branch: branch
        ? {
            _id: branch._id,
            name: branch.name,
            upiId: branch.upiId || null,
            upiQrUrl: branch.upiQrUrl || null,
          }
        : null,
      // Carry the clinic profile basics so the FE can default money formatting,
      // date formatting, and locale without an extra round-trip. Branding is
      // included so the FE-side prescription printer can render the clinic's
      // display name / logo / primary color without a settings fetch.
      clinic: clinic
        ? {
            _id: clinic._id,
            name: clinic.name,
            // Onboarding state, so the app can tell an approved clinic from
            // one still sitting in the queue. Missing on pre-existing rows,
            // which are active by definition.
            status: clinic.status ?? 'ACTIVE',
            currency: clinic.currency,
            timezone: clinic.timezone,
            countryCode: clinic.countryCode,
            branding: settings
              ? {
                  displayName: settings.branding.displayName,
                  logoUrl: settings.branding.logoUrl,
                  primaryColor: settings.branding.primaryColor,
                  upiId: settings.branding.upiId,
                  upiQrUrl: settings.branding.upiQrUrl,
                }
              : null,
          }
        : null,
      features,
      // Platform operators get the clinic approval queue in the app shell.
      // This is a DigiRx-staff flag, not a clinic role.
      isPlatformAdmin:
        (actor.user as { isPlatformAdmin?: boolean }).isPlatformAdmin === true,
      user: actor.user,
      roles: actor.roles,
      permissions: actor.permissions,
      // Per-user display timezone (empty → FE falls back to the clinic tz).
      displayTimezone: (actor.user as { displayTimezone?: string }).displayTimezone ?? null,
      // Presigned URL for the user's profile photo (uploaded by a Manager).
      profileImageUrl: await this.presignUserPhoto(actor.user as { profileImageKey?: string }),
    };
  }

  private async presignUserPhoto(user: { profileImageKey?: string }): Promise<string | null> {
    if (!user.profileImageKey) return null;
    try {
      return await this.storage.presignGet({ key: user.profileImageKey });
    } catch {
      return null;
    }
  }
}
