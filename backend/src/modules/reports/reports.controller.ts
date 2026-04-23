import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  @RequirePermissions(Permission.BillingRead)
  async revenue(
    @Req() req: AppRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    return await this.reports.revenueSummary(
      req.context!.clinicId,
      from,
      to,
      branchId,
    );
  }

  @Get('schedule/daily')
  @RequirePermissions(Permission.AppointmentRead)
  async daily(
    @Req() req: AppRequest,
    @Query('date') date: string,
    @Query('branchId') branchId: string,
  ) {
    return await this.reports.dailySchedule(
      req.context!.clinicId,
      date,
      branchId,
    );
  }

  @Get('pending-payments')
  @RequirePermissions(Permission.BillingRead)
  async pending(
    @Req() req: AppRequest,
    @Query('branchId') branchId?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return await this.reports.pendingPayments(
      req.context!.clinicId,
      branchId,
      limit,
    );
  }
}
