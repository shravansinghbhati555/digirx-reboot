import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CashDaysService } from './cash-days.service';
import { ApproveCashDayDto, SubmitCashCountDto } from './dto/submit-cash-count.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

@Controller('cash-days')
export class CashDaysController {
  constructor(private readonly cashDays: CashDaysService) {}

  private branchOf(req: AppRequest, raw?: string): Types.ObjectId {
    if (raw) {
      if (!Types.ObjectId.isValid(raw)) throw new BadRequestException('Invalid branchId');
      return new Types.ObjectId(raw);
    }
    const branchId = req.context!.branchId;
    if (!branchId) throw new BadRequestException('branchId is required');
    return branchId;
  }

  /** Expected cash for a branch-day, plus its count if one was submitted. */
  @Get()
  @RequirePermissions(Permission.BillingRead)
  async summary(
    @Req() req: AppRequest,
    @Query('date') date: string,
    @Query('branchId') branchId?: string,
  ) {
    if (!date || !DATE_RE.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    return await this.cashDays.summary(req.context!.clinicId, this.branchOf(req, branchId), date);
  }

  /** Counted days awaiting sign-off. */
  @Get('pending')
  @RequirePermissions(Permission.CashApprove)
  async pending(@Req() req: AppRequest) {
    return await this.cashDays.listPending(req.context!.clinicId);
  }

  /** Submit (or redo) the drawer count. Whoever takes cash counts it. */
  @Post()
  @RequirePermissions(Permission.BillingWrite)
  async submit(@Req() req: AppRequest, @Body() dto: SubmitCashCountDto) {
    return await this.cashDays.submit({
      clinicId: req.context!.clinicId,
      branchId: this.branchOf(req, dto.branchId),
      date: dto.date,
      countedCash: dto.countedCash,
      expectedCash: dto.expectedCash,
      note: dto.note,
      clientId: dto._id,
      actorUserId: req.context!.actorUserId,
      deviceId: req.context!.deviceId,
    });
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.CashApprove)
  async approve(@Req() req: AppRequest, @Param('id') id: string, @Body() dto: ApproveCashDayDto) {
    return await this.cashDays.approve({
      clinicId: req.context!.clinicId,
      id,
      note: dto.note,
      actorUserId: req.context!.actorUserId,
    });
  }
}
