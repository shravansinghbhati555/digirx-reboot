import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientsService } from './patients.service';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Post()
  @RequirePermissions(Permission.PatientWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreatePatientDto) {
    const clinicId = req.context!.clinicId;
    return await this.patients.create(clinicId, dto);
  }

  @Get()
  @RequirePermissions(Permission.PatientRead)
  async search(
    @Req() req: AppRequest,
    @Query('query') query?: string,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
  ) {
    const clinicId = req.context!.clinicId;
    const limit = Number(limitRaw ?? 25) || 25;
    return await this.patients.search(clinicId, { query, limit, before });
  }

  @Get(':id')
  @RequirePermissions(Permission.PatientRead)
  async get(@Req() req: AppRequest, @Param('id') id: string) {
    const clinicId = req.context!.clinicId;
    return await this.patients.getById(clinicId, id);
  }

  @Get(':id/history')
  @RequirePermissions(Permission.PatientRead)
  async history(@Req() req: AppRequest, @Param('id') id: string) {
    const clinicId = req.context!.clinicId;
    await this.patients.getById(clinicId, id);

    // Placeholder until appointments/encounters/billing are implemented.
    return {
      patientId: new Types.ObjectId(id),
      appointments: [],
      encounters: [],
      bills: [],
    };
  }
}
