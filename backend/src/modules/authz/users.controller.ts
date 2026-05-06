import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';
import { RequirePermissions } from './require-permissions.decorator';
import { UsersService } from './users.service';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.UserRead)
  async list(@Req() req: AppRequest) {
    return await this.users.list(req.context!.clinicId);
  }

  @Post()
  @RequirePermissions(Permission.UserWrite)
  async create(@Req() req: AppRequest, @Body() dto: any) {
    return await this.users.create(req.context!.clinicId, dto);
  }

  @Patch(':id/roles')
  @RequirePermissions(Permission.UserWrite)
  async updateRoles(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateUserRolesDto,
  ) {
    return await this.users.updateRoles(
      req.context!.clinicId,
      id,
      dto.roleIds,
    );
  }
}
