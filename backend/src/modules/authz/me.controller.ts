import { Controller, Get, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { AuthzService } from './authz.service';

@Controller()
export class MeController {
  constructor(private readonly authz: AuthzService) {}

  @Get('me')
  async me(@Req() req: AppRequest) {
    const actor = await this.authz.getActor({
      clinicId: req.context!.clinicId,
      actorUserId: req.context!.actorUserId,
    });

    return {
      clinicId: req.context!.clinicId,
      branchId: req.context!.branchId,
      user: actor.user,
      roles: actor.roles,
      permissions: actor.permissions,
    };
  }
}

