import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { toCsv } from './csv';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('revenue')
  @RequirePermissions(Permission.BillingRead)
  async revenue(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('format') format?: string,
  ) {
    const data = await this.reports.revenueSummary(
      req.context!.clinicId,
      from,
      to,
      branchId,
    );
    if (format === 'csv') {
      return sendCsv(res, `revenue-${from}-${to}.csv`, [
        {
          from,
          to,
          totalBilled: data.issuedBills.totalBilled,
          totalPaid: data.payments.totalPaid,
          totalRefunded: data.refunds.totalRefunded,
          netRevenue: data.netRevenue,
        },
      ]);
    }
    return data;
  }

  @Get('revenue/timeseries')
  @RequirePermissions(Permission.BillingRead)
  async revenueTimeseries(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bucket') bucket?: string,
    @Query('branchId') branchId?: string,
    @Query('format') format?: string,
  ) {
    const data = await this.reports.revenueTimeseries(
      req.context!.clinicId,
      from,
      to,
      bucket,
      branchId,
    );
    if (format === 'csv') {
      return sendCsv(res, `revenue-${data.bucket}-${from}-${to}.csv`, data.buckets);
    }
    return data;
  }

  @Get('doctor-utilization')
  @RequirePermissions(Permission.AppointmentRead)
  async doctorUtilization(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
    @Query('format') format?: string,
  ) {
    const data = await this.reports.doctorUtilization(
      req.context!.clinicId,
      from,
      to,
      branchId,
    );
    if (format === 'csv') {
      return sendCsv(res, `utilization-${from}-${to}.csv`, data.doctors);
    }
    return data;
  }

  @Get('patients/new-vs-returning')
  @RequirePermissions(Permission.AppointmentRead)
  async newVsReturning(
    @Req() req: AppRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return await this.reports.newVsReturningPatients(
      req.context!.clinicId,
      from,
      to,
    );
  }

  @Get('schedule/daily')
  @RequirePermissions(Permission.AppointmentRead)
  async daily(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('date') date: string,
    @Query('branchId') branchId: string,
    @Query('format') format?: string,
  ) {
    const daily = await this.reports.dailySchedule(
      req.context!.clinicId,
      date,
      branchId,
    );
    if (format === 'csv') {
      const flat = daily.items.map((a: any) => ({
        type: a.type,
        status: a.status,
        startAt: a.startAt ?? '',
        queueDate: a.queueDate ?? '',
        queueNumber: a.queueNumber ?? '',
        doctorId: a.doctorId,
        patientId:
          typeof a.patientId === 'object' && a.patientId
            ? (a.patientId as any).fullName
            : a.patientId,
      }));
      return sendCsv(res, `schedule-${date}.csv`, flat);
    }
    return daily;
  }

  @Get('pending-payments')
  @RequirePermissions(Permission.BillingRead)
  async pending(
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
    @Query('branchId') branchId?: string,
    @Query('limit') limitRaw?: string,
    @Query('format') format?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    const data = await this.reports.pendingPayments(
      req.context!.clinicId,
      branchId,
      limit,
    );
    if (format === 'csv') {
      const flat = data.rows.map((b: any) => ({
        billNo: b.billNo ?? '',
        patientName: b.patient?.fullName ?? '',
        total: b.total,
        totalPaid: b.totalPaid,
        outstanding: b.outstanding,
        status: b.status,
      }));
      return sendCsv(res, `pending-payments.csv`, flat);
    }
    return data;
  }
}

/**
 * Sends a CSV body with appropriate headers. The route is declared
 * `passthrough: true` so we still return the body string from the
 * controller — Nest writes it as-is once we've set the content-type.
 */
function sendCsv(res: Response, filename: string, rows: Array<Record<string, unknown>>) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return toCsv(rows);
}
