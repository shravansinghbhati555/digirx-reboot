import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appts: AppointmentsService) { }

  @Post()
  @RequirePermissions(Permission.AppointmentWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateAppointmentDto) {
    return await this.appts.create(
      req.context!.clinicId,
      req.context!.actorUserId,
      dto,
    );
  }

  @Get()
  @RequirePermissions(Permission.AppointmentRead)
  async list(
    @Req() req: AppRequest,
    @Query('branchId') branchId?: string,
    @Query('date') date?: string,
    @Query('patientId') patientId?: string,
    @Query('doctorId') doctorId?: string,
    @Query('limit') limit?: string,
    // The viewer's display timezone — used to compute the day window so
    // each user's day view follows their own timezone (Option B). Falls
    // back to the clinic timezone when omitted.
    @Query('tz') tz?: string,
  ) {
    if (date && branchId) {
      return await this.appts.listByDate(
        req.context!.clinicId,
        branchId,
        date,
        doctorId,
        tz,
      );
    }
    return await this.appts.findAll(req.context!.clinicId, {
      branchId,
      patientId,
      doctorId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // `no-store`: this is the slot picker; staleness causes real bookings
  // to fail with 409 (or worse, leak). Always pull fresh from Mongo.
  @Get('slots')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @RequirePermissions(Permission.AppointmentRead)
  async slots(
    @Req() req: AppRequest,
    @Query('branchId') branchId: string,
    @Query('doctorId') doctorId: string,
    @Query('date') date: string,
    @Query('duration') durationRaw?: string,
  ) {
    // Duration in minutes — drives whether each slot can fit a booking
    // of that length. The service falls back to the rule's slotMinutes
    // when omitted.
    const duration = durationRaw ? Number(durationRaw) : undefined;
    return await this.appts.availableSlots({
      clinicId: req.context!.clinicId,
      branchId,
      doctorId,
      date,
      duration: duration && Number.isFinite(duration) ? duration : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission.AppointmentRead)
  async getOne(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.appts.getById(req.context!.clinicId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.AppointmentWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return await this.appts.update(req.context!.clinicId, id, dto);
  }

  @Post(':id/checkin')
  @RequirePermissions(Permission.AppointmentWrite)
  async checkin(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.appts.checkin(req.context!.clinicId, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(Permission.AppointmentWrite)
  async cancel(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: CancelAppointmentDto,
  ) {
    return await this.appts.cancel(
      req.context!.clinicId,
      id,
      req.context!.actorUserId,
      body.reason,
    );
  }
}
