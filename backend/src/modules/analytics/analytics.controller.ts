import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from '../authz/permissions';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Raw daily rows. The FE chart components consume this directly; an
   * external BI pipeline can scrape the same shape via a service token.
   */
  @Get('daily-stats')
  @RequirePermissions(Permission.BillingRead)
  async list(
    @Req() req: AppRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    }
    return await this.analytics.listDailyStats(req.context!.clinicId, {
      from,
      to,
      branchId,
    });
  }

  @Get('summary')
  @RequirePermissions(Permission.BillingRead)
  async summary(
    @Req() req: AppRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    if (!from || !to) {
      throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    }
    return await this.analytics.summarize(req.context!.clinicId, {
      from,
      to,
      branchId,
    });
  }

  /**
   * Backfill — re-runs aggregation for a single date across every branch.
   * Used after a fix-forward when yesterday's totals were wrong, or to
   * seed historical rows after the feature ships.
   *
   * `clinic:write` on purpose: this is an admin / ops action.
   */
  @Post('backfill')
  @RequirePermissions(Permission.ClinicWrite)
  async backfill(@Query('date') date?: string) {
    if (!date) throw new BadRequestException('date is required (YYYY-MM-DD)');
    return await this.analytics.aggregateForDate(date);
  }
}
