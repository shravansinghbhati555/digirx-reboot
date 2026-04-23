import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { CreateEncounterDto } from './dto/create-encounter.dto';
import { UpdateEncounterDto } from './dto/update-encounter.dto';
import { EncountersService } from './encounters.service';

@Controller('encounters')
export class EncountersController {
  constructor(private readonly encounters: EncountersService) {}

  @Post()
  @RequirePermissions(Permission.PatientWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateEncounterDto) {
    return await this.encounters.create(req.context!.clinicId, dto);
  }

  @Get(':id')
  @RequirePermissions(Permission.PatientRead)
  async get(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.encounters.getById(req.context!.clinicId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.PatientWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateEncounterDto,
  ) {
    return await this.encounters.update(req.context!.clinicId, id, dto);
  }

  @Post(':id/sign')
  @RequirePermissions(Permission.PatientWrite)
  async sign(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.encounters.sign(req.context!.clinicId, id);
  }
}
