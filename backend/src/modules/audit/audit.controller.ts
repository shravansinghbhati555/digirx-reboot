import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from '../authz/permissions';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /**
   * Clinic-scoped read-only audit trail. Admin-only (clinic:write) by design —
   * regular users shouldn't see who changed what. Pagination via the standard
   * `before` cursor (last row's createdAt) + `limit`.
   */
  @Get()
  @RequirePermissions(Permission.AuditRead)
  async list(
    @Req() req: AppRequest,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('actorUserId') actorUserId?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return await this.audit.list(req.context!.clinicId, {
      limit,
      before,
      entityType,
      action,
      actorUserId,
    });
  }
}
