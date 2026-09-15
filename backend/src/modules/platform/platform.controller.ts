import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformService } from './platform.service';
import { ClinicDecisionDto } from './dto/clinic-decision.dto';

/**
 * Clinic approval queue for the DigiRx platform team.
 *
 * `@RequirePermissions()` with no arguments satisfies the global default-deny
 * guard (authenticated, any permission); `PlatformAdminGuard` then does the
 * real check. Both are required — dropping either one would either 403 every
 * call or open cross-tenant data to ordinary clinic admins.
 */
@Controller('platform/clinics')
@RequirePermissions()
@UseGuards(PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('summary')
  async summary() {
    return this.platform.summary();
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('query') query?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return this.platform.list({ status, query, limit });
  }

  @Post(':id/approve')
  async approve(@Req() req: AppRequest, @Param('id') id: string) {
    return this.platform.approve(id, req.context!.actorUserId!);
  }

  @Post(':id/reject')
  async reject(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: ClinicDecisionDto,
  ) {
    return this.platform.reject(id, req.context!.actorUserId!, body.reason);
  }

  @Post(':id/suspend')
  async suspend(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: ClinicDecisionDto,
  ) {
    return this.platform.suspend(id, req.context!.actorUserId!, body.reason);
  }

  // Reactivating is the same transition as approving: back to ACTIVE with the
  // reason cleared.
  @Post(':id/reactivate')
  async reactivate(@Req() req: AppRequest, @Param('id') id: string) {
    return this.platform.approve(id, req.context!.actorUserId!);
  }
}
