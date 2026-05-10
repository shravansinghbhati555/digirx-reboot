import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { Types } from 'mongoose';
import { AvailabilityService } from './availability.service';
import { UpsertDoctorRulesDto } from './dto/upsert-rules.dto';
import { UpsertDoctorOverrideDto } from './dto/upsert-override.dto';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  // `no-store`: availability rules can change at any time; the day view
  // must always reflect the current rules + active overrides.
  @Get('doctors/:doctorUserId/day')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @RequirePermissions(Permission.ClinicRead)
  async getDay(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Query('date') date: string,
    @Query('branchId') branchId: string,
  ) {
    return await this.availability.getDaySlots({
      clinicId: req.context!.clinicId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      date,
    });
  }

  @Get('doctors/:doctorUserId/rules')
  @RequirePermissions(Permission.ClinicRead)
  async listRules(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Query('branchId') branchId: string,
  ) {
    return await this.availability.listRules({
      clinicId: req.context!.clinicId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
    });
  }

  @Get('doctors/:doctorUserId/overrides')
  @RequirePermissions(Permission.ClinicRead)
  async listOverrides(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Query('branchId') branchId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return await this.availability.listOverrides({
      clinicId: req.context!.clinicId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      from,
      to,
    });
  }

  @Put('doctors/:doctorUserId/rules')
  @RequirePermissions(Permission.ClinicRead)
  async putRules(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Query('branchId') branchId: string,
    @Body() body: UpsertDoctorRulesDto,
  ) {
    return await this.availability.replaceWeeklyRules({
      clinicId: req.context!.clinicId,
      actorUserId: req.context!.actorUserId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      rules: body.rules,
    });
  }

  @Put('doctors/:doctorUserId/overrides/:date')
  @RequirePermissions(Permission.ClinicRead)
  async putOverride(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Param('date') date: string,
    @Query('branchId') branchId: string,
    @Body() body: UpsertDoctorOverrideDto,
  ) {
    return await this.availability.upsertOverride({
      clinicId: req.context!.clinicId,
      actorUserId: req.context!.actorUserId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      date,
      type: body.type,
      windows: body.windows as any,
      note: body.note,
    });
  }

  // Convenience: close for a day
  @Patch('doctors/:doctorUserId/overrides/:date/close')
  @RequirePermissions(Permission.ClinicRead)
  async closeDay(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Param('date') date: string,
    @Query('branchId') branchId: string,
  ) {
    return await this.availability.upsertOverride({
      clinicId: req.context!.clinicId,
      actorUserId: req.context!.actorUserId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      date,
      type: 'CLOSED',
    });
  }
}
