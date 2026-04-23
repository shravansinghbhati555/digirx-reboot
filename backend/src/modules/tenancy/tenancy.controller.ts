import { Body, Controller, Get, Patch, Req, UsePipes, ValidationPipe } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { PatchClinicSettingsDto } from './dto/patch-clinic-settings.dto';
import { TenancyService } from './tenancy.service';

@Controller('clinic')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
)
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('settings')
  @RequirePermissions(Permission.ClinicRead)
  async getSettings(@Req() req: AppRequest) {
    return await this.tenancy.getSettings(req.context!.clinicId);
  }

  @Patch('settings')
  @RequirePermissions(Permission.ClinicWrite)
  async patchSettings(@Req() req: AppRequest, @Body() body: PatchClinicSettingsDto) {
    return await this.tenancy.patchSettings(req.context!.clinicId, body);
  }
}

