import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';
import { RequirePermissions } from './require-permissions.decorator';
import { RolesService } from './roles.service';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(Permission.ClinicWrite)
  async list(@Req() req: AppRequest) {
    return await this.roles.list(req.context!.clinicId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ClinicWrite)
  async updatePermissions(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
  ) {
    return await this.roles.updatePermissions(
      req.context!.clinicId,
      id,
      dto.permissions,
    );
  }
}
