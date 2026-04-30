import { Body, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { PatchClinicSettingsDto } from './dto/patch-clinic-settings.dto';
import { TenancyService } from './tenancy.service';
import { Public } from '../../common/public.decorator';

@Controller('clinic')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('search')
  @Public()
  async search(@Query('q') q: string) {
    return await this.tenancy.searchClinics(q);
  }

  @Get(':id/branches')
  @Public()
  async listBranches(@Param('id') id: string) {
    return await this.tenancy.listBranches(id);
  }

  @Get('settings')
  @RequirePermissions(Permission.ClinicRead)
  async getSettings(@Req() req: AppRequest) {
    return await this.tenancy.getSettings(req.context!.clinicId);
  }

  @Patch('settings')
  @RequirePermissions(Permission.ClinicWrite)
  async patchSettings(
    @Req() req: AppRequest,
    @Body() body: PatchClinicSettingsDto,
  ) {
    return await this.tenancy.patchSettings(req.context!.clinicId, body);
  }
}
