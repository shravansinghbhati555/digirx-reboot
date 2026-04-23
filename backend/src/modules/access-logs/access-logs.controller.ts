import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { AccessLogsService } from './access-logs.service';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';

@Controller('access-logs')
export class AccessLogsController {
  constructor(private readonly logs: AccessLogsService) {}

  @Get()
  @RequirePermissions(Permission.ClinicRead)
  async list(
    @Req() req: AppRequest,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
    @Query('path') path?: string,
    @Query('method') method?: string,
    @Query('statusCode') statusCodeRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    const statusCode = statusCodeRaw ? Number(statusCodeRaw) : undefined;
    return await this.logs.list(req.context!.clinicId, { limit, before, path, method, statusCode });
  }

  @Get('export')
  @RequirePermissions(Permission.ClinicRead)
  async export(
    @Req() req: AppRequest,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
  ) {
    const limit = Number(limitRaw ?? 200) || 200;
    return await this.logs.list(req.context!.clinicId, { limit, before });
  }
}

