import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { PatchClinicSettingsDto } from './dto/patch-clinic-settings.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { TenancyService } from './tenancy.service';
import { Public } from '../../common/public.decorator';

@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Get('clinic/search')
  @Public()
  async search(@Query('q') q: string) {
    return await this.tenancy.searchClinics(q);
  }

  @Get('clinic/:id/branches')
  @Public()
  async listBranches(@Param('id') id: string) {
    return await this.tenancy.listBranches(id);
  }

  @Get('clinics/:id/settings')
  @RequirePermissions(Permission.ClinicRead)
  async getSettings(@Req() req: AppRequest, @Param('id') id: string) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.getSettings(clinicId);
  }

  @Patch('clinics/:id/settings')
  @RequirePermissions(Permission.ClinicWrite)
  async patchSettings(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: PatchClinicSettingsDto,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.patchSettings(clinicId, body);
  }

  @Get('clinics/:id/branches')
  @RequirePermissions(Permission.ClinicRead)
  async listBranchesAdmin(@Req() req: AppRequest, @Param('id') id: string) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.listBranchesAdmin(clinicId);
  }

  @Post('clinics/:id/branches')
  @RequirePermissions(Permission.ClinicWrite)
  async createBranch(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: CreateBranchDto,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.createBranch(clinicId, body);
  }

  @Patch('clinics/:id/branches/:branchId')
  @RequirePermissions(Permission.ClinicWrite)
  async updateBranch(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() body: UpdateBranchDto,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.updateBranch(clinicId, branchId, body);
  }
}
