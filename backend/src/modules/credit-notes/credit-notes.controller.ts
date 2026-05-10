import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreditNotesService } from './credit-notes.service';
import { CancelCreditNoteDto } from './dto/cancel-credit-note.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { RefundCreditNoteDto } from './dto/refund-credit-note.dto';

@Controller()
export class CreditNotesController {
  constructor(private readonly creditNotes: CreditNotesService) {}

  @Post('bills/:billId/credit-notes')
  @RequirePermissions(Permission.BillingWrite)
  async create(
    @Req() req: AppRequest,
    @Param('billId') billId: string,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return await this.creditNotes.create(
      req.context!.clinicId,
      req.context!.actorUserId,
      billId,
      dto,
    );
  }

  @Get('bills/:billId/credit-notes')
  @RequirePermissions(Permission.BillingRead)
  async listForBill(
    @Req() req: AppRequest,
    @Param('billId') billId: string,
  ) {
    return await this.creditNotes.listForBill(req.context!.clinicId, billId);
  }

  @Get('credit-notes/:id')
  @RequirePermissions(Permission.BillingRead)
  async getOne(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.creditNotes.getById(req.context!.clinicId, id);
  }

  @Post('credit-notes/:id/refund')
  @RequirePermissions(Permission.BillingWrite)
  async refund(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: RefundCreditNoteDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const before = await this.creditNotes.getById(req.context!.clinicId, id);
    const refunded = await this.creditNotes.refund(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
      dto,
    );
    // If we got back a record that was already REFUNDED with the same key,
    // the request was an idempotent replay — flag it so clients know not
    // to show "refund recorded" again.
    if (
      before.status === 'REFUNDED' &&
      before.refundIdempotencyKey === dto.idempotencyKey
    ) {
      res.setHeader('X-Idempotent-Replay', 'true');
    }
    return refunded;
  }

  @Post('credit-notes/:id/cancel')
  @RequirePermissions(Permission.BillingWrite)
  async cancel(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: CancelCreditNoteDto,
  ) {
    return await this.creditNotes.cancel(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
      dto,
    );
  }
}
