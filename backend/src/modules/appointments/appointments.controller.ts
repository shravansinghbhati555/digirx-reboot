import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentsService } from './appointments.service';

@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appts: AppointmentsService) {}

  @Post()
  @RequirePermissions(Permission.AppointmentWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateAppointmentDto) {
    return await this.appts.create(req.context!.clinicId, req.context!.actorUserId, dto);
  }

  @Get()
  @RequirePermissions(Permission.AppointmentRead)
  async list(@Req() req: AppRequest, @Query('branchId') branchId: string, @Query('date') date: string, @Query('doctorId') doctorId?: string) {
    return await this.appts.listByDate(req.context!.clinicId, branchId, date, doctorId);
  }

  @Get('slots')
  @RequirePermissions(Permission.AppointmentRead)
  async slots(
    @Req() req: AppRequest,
    @Query('branchId') branchId: string,
    @Query('doctorId') doctorId: string,
    @Query('date') date: string,
  ) {
    return await this.appts.availableSlots({ clinicId: req.context!.clinicId, branchId, doctorId, date });
  }

  @Patch(':id')
  @RequirePermissions(Permission.AppointmentWrite)
  async update(@Req() req: AppRequest, @Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return await this.appts.update(req.context!.clinicId, id, dto);
  }

  @Post(':id/checkin')
  @RequirePermissions(Permission.AppointmentWrite)
  async checkin(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.appts.checkin(req.context!.clinicId, id);
  }
}

