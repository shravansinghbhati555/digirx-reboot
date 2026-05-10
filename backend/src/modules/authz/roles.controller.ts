import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';
import { RequirePermissions } from './require-permissions.decorator';
import { RolesService } from './roles.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(Permission.UserRead)
  async list(@Req() req: AppRequest) {
    return await this.roles.list(req.context!.clinicId);
  }

  @Post()
  @RequirePermissions(Permission.UserWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateRoleDto) {
    return await this.roles.create(
      req.context!.clinicId,
      dto.name,
      dto.permissions,
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.UserWrite)
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
