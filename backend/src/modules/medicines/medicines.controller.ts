import {
  Body,
  Controller,
  Delete,
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
import { CreateMedicineDto } from './dto/create-medicine.dto';
import { UpdateMedicineDto } from './dto/update-medicine.dto';
import { MedicinesService } from './medicines.service';

// PatientWrite is the closest existing capability — the catalog is a
// clinical-content resource and the people who curate it (doctors,
// nurses) already hold patient:write. A dedicated `medicine:*` enum
// would be cleaner but adding that touches every role's permission
// list; deferring until it's proven necessary.
@Controller('medicines')
export class MedicinesController {
  constructor(private readonly medicines: MedicinesService) {}

  @Post()
  @RequirePermissions(Permission.PatientWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateMedicineDto) {
    return await this.medicines.create(req.context!.clinicId, dto);
  }

  @Get()
  @RequirePermissions(Permission.PatientRead)
  async list(
    @Req() req: AppRequest,
    @Query('query') query?: string,
    @Query('activeOnly') activeOnly?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 25) || 25;
    return await this.medicines.search(req.context!.clinicId, {
      query,
      activeOnly: activeOnly === 'true' || activeOnly === '1',
      limit,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission.PatientRead)
  async getOne(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.medicines.getById(req.context!.clinicId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PatientWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateMedicineDto,
  ) {
    return await this.medicines.update(req.context!.clinicId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.PatientWrite)
  async remove(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.medicines.remove(req.context!.clinicId, id);
  }
}
