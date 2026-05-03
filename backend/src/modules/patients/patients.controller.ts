import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
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
    return await this.patients.getHistory(req.context!.clinicId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PatientWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdatePatientDto,
  ) {
    return await this.patients.update(req.context!.clinicId, id, dto);
  }
}
