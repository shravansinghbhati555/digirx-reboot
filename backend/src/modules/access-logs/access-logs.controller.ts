import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { AccessLogsService } from './access-logs.service';

@Controller('access-logs')
export class AccessLogsController {
  constructor(private readonly logs: AccessLogsService) {}

  @Get()
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
  async export(
    @Req() req: AppRequest,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
  ) {
    const limit = Number(limitRaw ?? 200) || 200;
    return await this.logs.list(req.context!.clinicId, { limit, before });
  }
}

