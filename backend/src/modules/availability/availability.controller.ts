import {
  Body,
  Controller,
  Get,
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

  @Get('doctors/:doctorUserId/day')
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

  @Put('doctors/:doctorUserId/rules')
  @RequirePermissions(Permission.ClinicWrite)
  async putRules(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Query('branchId') branchId: string,
    @Body() body: UpsertDoctorRulesDto,
  ) {
    return await this.availability.replaceWeeklyRules({
      clinicId: req.context!.clinicId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      rules: body.rules,
    });
  }

  @Put('doctors/:doctorUserId/overrides/:date')
  @RequirePermissions(Permission.ClinicWrite)
  async putOverride(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Param('date') date: string,
    @Query('branchId') branchId: string,
    @Body() body: UpsertDoctorOverrideDto,
  ) {
    return await this.availability.upsertOverride({
      clinicId: req.context!.clinicId,
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
  @RequirePermissions(Permission.ClinicWrite)
  async closeDay(
    @Req() req: AppRequest,
    @Param('doctorUserId') doctorUserId: string,
    @Param('date') date: string,
    @Query('branchId') branchId: string,
  ) {
    return await this.availability.upsertOverride({
      clinicId: req.context!.clinicId,
      branchId: new Types.ObjectId(branchId),
      doctorUserId: new Types.ObjectId(doctorUserId),
      date,
      type: 'CLOSED',
    });
  }
}
