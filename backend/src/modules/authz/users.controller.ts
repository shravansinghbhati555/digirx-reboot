import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from './permissions';
import { RequirePermissions } from './require-permissions.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(Permission.UserRead)
  async list(@Req() req: AppRequest, @Query('query') query?: string) {
    return await this.users.list(req.context!.clinicId, query);
  }

  @Post()
  @RequirePermissions(Permission.UserWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateUserDto) {
    return await this.users.create(req.context!.clinicId, dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.UserWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return await this.users.update(req.context!.clinicId, id, dto);
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

  @Post(':id/password-reset')
  @RequirePermissions(Permission.UserWrite)
  async resetPassword(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return await this.users.resetPassword(
      req.context!.clinicId,
      id,
      dto.newPassword,
    );
  }
}
