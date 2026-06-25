import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { PatchClinicSettingsDto } from './dto/patch-clinic-settings.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { TenancyService } from './tenancy.service';
import { Public } from '../../common/public.decorator';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp']);

@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  // Public for the multi-step login flow (clinic picker before sign-in).
  // Capped at 10/min per IP to make bulk enumeration impractical.
  @Get('clinic/search')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async search(@Query('q') q: string) {
    return await this.tenancy.searchClinics(q);
  }

  @Get('clinic/:id/branches')
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  // The clinic's identity — its name and branding display name — is its
  // public face, so editing it is restricted to Manager / Super Admin and
  // kept off the general clinic:write surface. `@RequirePermissions()`
  // just requires an authenticated tenant context; the role check below
  // is the real gate.
  @Patch('clinics/:id/identity')
  @RequirePermissions()
  async updateIdentity(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: { name?: string; displayName?: string | null },
  ) {
    const roles = req.actorRoleNames ?? new Set<string>();
    if (!roles.has('manager') && !roles.has('super admin')) {
      throw new ForbiddenException('Only a Manager or Super Admin can edit the clinic name or display name');
    }
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.updateClinicIdentity(clinicId, {
      name: body?.name,
      displayName: body?.displayName,
    });
  }

  @Get('clinics/:id/branches')
  @RequirePermissions(Permission.BranchRead)
  async listBranchesAdmin(@Req() req: AppRequest, @Param('id') id: string) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.listBranchesAdmin(clinicId);
  }

  @Post('clinics/:id/branches')
  @RequirePermissions(Permission.BranchWrite)
  async createBranch(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: CreateBranchDto,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.createBranch(clinicId, body);
  }

  @Patch('clinics/:id/branches/:branchId')
  @RequirePermissions(Permission.BranchWrite)
  async updateBranch(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Param('branchId') branchId: string,
    @Body() body: UpdateBranchDto,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.updateBranch(clinicId, branchId, body);
  }

  @Get('clinics/:id/branches/:branchId')
  @RequirePermissions(Permission.ClinicRead)
  async getBranch(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Param('branchId') branchId: string,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.getBranch(clinicId, branchId);
  }

  // ---- Clinic logo (Settings → Branding) ----------------------------
  // Uploads a PNG/JPG/WebP to S3 and records a marker in
  // branding.logoUrl so the prescription PDF + the Settings preview can
  // both read it back. Read endpoint is intentionally public so a
  // simple <img src> in the FE works without auth-juggling — the bytes
  // are already meant to appear on patient-facing prescriptions.

  @Post('clinics/:id/logo')
  @RequirePermissions(Permission.ClinicWrite)
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: LOGO_MAX_BYTES } }),
  )
  async uploadLogo(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    if (!file) throw new BadRequestException('image is required (multipart field "image")');
    if (!LOGO_ACCEPTED.has(file.mimetype)) {
      throw new BadRequestException(`Unsupported type ${file.mimetype} — use PNG, JPG, or WebP`);
    }
    return await this.tenancy.uploadLogo({
      clinicId,
      bytes: new Uint8Array(file.buffer),
      contentType: file.mimetype,
    });
  }

  @Get('clinics/:id/logo')
  @Public()
  async getLogo(@Param('id') id: string, @Res() res: Response) {
    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      res.status(404).end();
      return;
    }
    const result = await this.tenancy.getLogo(
      // Re-parse without tenant check since this endpoint is public.
      // It only serves a deliberately-public asset (the clinic's logo),
      // so leaking the existence of a clinic ID via 200-vs-404 is
      // acceptable.
      this.tenancy.parseClinicId(id),
    );
    if (!result) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.end(Buffer.from(result.bytes));
  }

  @Delete('clinics/:id/logo')
  @RequirePermissions(Permission.ClinicWrite)
  async deleteLogo(@Req() req: AppRequest, @Param('id') id: string) {
    const clinicId = this.tenancy.assertTenantMatch(id, req.context!.clinicId);
    return await this.tenancy.deleteLogo(clinicId);
  }
}
