import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Header } from '@nestjs/common';
import { Types } from 'mongoose';
import { Portal, PortalRoute } from '../portal.decorators';
import type { PortalCtx } from '../portal.context';
import {
  AddDependantDto,
  BookAppointmentDto,
  CancelAppointmentDto,
  ClinicSharingDto,
  FamilyGrantsDto,
  InviteFamilyDto,
  MarkReadDto,
  NextAvailableDto,
  RescheduleAppointmentDto,
  RespondInviteDto,
  UpdatePrivacyDto,
  UpdateProfileDto,
  VerifyPortalPaymentDto,
} from '../dto/portal.dto';
import { PortalMeService } from '../services/portal-me.service';
import { PortalRecordsService } from '../services/portal-records.service';
import { PortalAppointmentsService } from '../services/portal-appointments.service';
import { PortalDirectoryService } from '../services/portal-directory.service';
import { PortalFamilyService } from '../services/portal-family.service';
import { PortalPaymentsService } from '../services/portal-payments.service';

/**
 * Patient-portal API. Thin: every handler passes the authenticated caller
 * to a portal service, which resolves ownership before touching any record.
 */
@Controller('portal')
@PortalRoute()
export class PortalController {
  constructor(
    private readonly me: PortalMeService,
    private readonly records: PortalRecordsService,
    private readonly appointments: PortalAppointmentsService,
    private readonly directory: PortalDirectoryService,
    private readonly family: PortalFamilyService,
    private readonly payments: PortalPaymentsService,
  ) {}

  // --- Me ---------------------------------------------------------------------

  @Get('bootstrap')
  @Header('Cache-Control', 'no-store')
  bootstrap(@Portal() ctx: PortalCtx) {
    return this.me.bootstrap(ctx);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  getMe(@Portal() ctx: PortalCtx) {
    return this.me.patient(ctx);
  }

  @Patch('me')
  updateMe(@Portal() ctx: PortalCtx, @Body() body: UpdateProfileDto) {
    return this.me.updateProfile(ctx, body);
  }

  @Patch('me/privacy')
  async updatePrivacy(
    @Portal() ctx: PortalCtx,
    @Body() body: UpdatePrivacyDto,
  ) {
    await this.me.updatePrivacy(ctx, body);
    return { ok: true };
  }

  @Put('me/record-sharing/:clinicId')
  setSharing(
    @Portal() ctx: PortalCtx,
    @Param('clinicId') clinicId: string,
    @Body() body: ClinicSharingDto,
  ) {
    return this.me.setClinicSharing(ctx, clinicId, body.enabled);
  }

  @Post('notifications/read')
  @HttpCode(200)
  async markRead(@Portal() ctx: PortalCtx, @Body() body: MarkReadDto) {
    await this.me.markRead(ctx, body.ids);
    return { ok: true };
  }

  // --- Records ------------------------------------------------------------------

  @Get('records')
  @Header('Cache-Control', 'no-store')
  allRecords(@Portal() ctx: PortalCtx) {
    return this.records.bundle(ctx);
  }

  @Get('visits/:id')
  visit(@Portal() ctx: PortalCtx, @Param('id') id: string) {
    return this.records.visit(ctx, id);
  }

  @Get('reports/:id/download')
  @Header('Cache-Control', 'no-store')
  report(@Portal() ctx: PortalCtx, @Param('id') id: string) {
    return this.records.reportDownload(ctx, id);
  }

  @Get('prescriptions/:id/pdf')
  @Header('Cache-Control', 'no-store')
  rxPdf(@Portal() ctx: PortalCtx, @Param('id') id: string) {
    return this.records.rxPdf(ctx, id);
  }

  @Get('bills/:id/pdf')
  @Header('Cache-Control', 'no-store')
  billPdf(@Portal() ctx: PortalCtx, @Param('id') id: string) {
    return this.records.billPdf(ctx, id);
  }

  @Post('bills/:id/pay/order')
  payOrder(@Portal() ctx: PortalCtx, @Param('id') id: string) {
    return this.payments.createOrder(ctx, id);
  }

  @Post('bills/:id/pay/verify')
  @HttpCode(200)
  payVerify(
    @Portal() ctx: PortalCtx,
    @Param('id') id: string,
    @Body() body: VerifyPortalPaymentDto,
  ) {
    return this.payments.verify(ctx, id, body);
  }

  // --- Discovery + booking ------------------------------------------------------

  @Get('appointments')
  @Header('Cache-Control', 'no-store')
  listAppointments(@Portal() ctx: PortalCtx) {
    return this.appointments.list(ctx);
  }

  @Get('slots')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async slots(
    @Query('clinicId') clinicId: string,
    @Query('doctorId') doctorId: string,
    @Query('date') date: string,
    @Query('ignoreAppointmentId') ignore?: string,
  ) {
    const info = await this.directory.bookableBranch(clinicId);
    await this.directory.bookableDoctor(info, doctorId);
    const { groups } = await this.directory.slots(
      info,
      doctorId,
      date,
      ignore && Types.ObjectId.isValid(ignore) ? ignore : undefined,
    );
    return { date, groups };
  }

  @Post('availability/next')
  @HttpCode(200)
  async nextAvailable(@Body() body: NextAvailableDto) {
    const out: Array<{
      clinicId: string;
      doctorId: string;
      next: { date: string; times: string[] } | null;
    }> = [];
    for (const item of body.items) {
      let next: { date: string; times: string[] } | null = null;
      try {
        const info = await this.directory.bookableBranch(item.clinicId);
        await this.directory.bookableDoctor(info, item.doctorId);
        next = await this.directory.nextAvailable(info, item.doctorId);
      } catch {
        next = null; // not bookable online
      }
      out.push({ ...item, next });
    }
    return { items: out };
  }

  @Post('appointments')
  book(@Portal() ctx: PortalCtx, @Body() body: BookAppointmentDto) {
    return this.appointments.book(ctx, body);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  cancel(
    @Portal() ctx: PortalCtx,
    @Param('id') id: string,
    @Body() body: CancelAppointmentDto,
  ) {
    return this.appointments.cancel(ctx, id, body.reason);
  }

  @Post('appointments/:id/reschedule')
  @HttpCode(200)
  reschedule(
    @Portal() ctx: PortalCtx,
    @Param('id') id: string,
    @Body() body: RescheduleAppointmentDto,
  ) {
    return this.appointments.reschedule(ctx, id, body.date, body.time);
  }

  // --- Family -------------------------------------------------------------------

  @Get('family')
  @Header('Cache-Control', 'no-store')
  listFamily(@Portal() ctx: PortalCtx) {
    return this.family.list(ctx);
  }

  @Post('family/dependants')
  async addDependant(@Portal() ctx: PortalCtx, @Body() body: AddDependantDto) {
    const dep = await this.family.addDependant(ctx, body);
    return { id: dep._id.toHexString() };
  }

  @Post('family/invites')
  invite(@Portal() ctx: PortalCtx, @Body() body: InviteFamilyDto) {
    return this.family.invite(ctx, body);
  }

  @Post('family/invites/:id/respond')
  @HttpCode(200)
  async respond(
    @Portal() ctx: PortalCtx,
    @Param('id') id: string,
    @Body() body: RespondInviteDto,
  ) {
    await this.family.respond(ctx, id, body.accept);
    return { ok: true };
  }

  @Put('family/:connectionId/grants')
  setGrants(
    @Portal() ctx: PortalCtx,
    @Param('connectionId') id: string,
    @Body() body: FamilyGrantsDto,
  ) {
    return this.family.setGrants(ctx, id, body);
  }

  @Delete('family/:id')
  async removeMember(@Portal() ctx: PortalCtx, @Param('id') id: string) {
    await this.family.remove(ctx, id);
    return { ok: true };
  }
}
