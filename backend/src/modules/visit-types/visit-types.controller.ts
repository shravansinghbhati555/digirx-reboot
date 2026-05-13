import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { VisitTypesService } from './visit-types.service';
import { CreateVisitTypeDto } from './dto/create-visit-type.dto';
import { UpdateVisitTypeDto } from './dto/update-visit-type.dto';

@Controller('visit-types')
export class VisitTypesController {
  constructor(private readonly visitTypes: VisitTypesService) {}

  // Listing is broadly readable — Front Desk needs the doctor's
  // catalog to populate the BookSheet picker. Mutations are
  // gated server-side on "admin OR self" inside the service.
  @Get()
  @RequirePermissions(Permission.ClinicRead)
  async list(
    @Req() req: AppRequest,
    @Query('doctorId') doctorId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return await this.visitTypes.list(
      req.context!.clinicId,
      doctorId,
      includeInactive === 'true',
    );
  }

  @Post()
  @RequirePermissions(Permission.ClinicRead)
  async create(@Req() req: AppRequest, @Body() dto: CreateVisitTypeDto) {
    return await this.visitTypes.create(
      req.context!.clinicId,
      req.context!.actorUserId,
      dto,
    );
  }

  @Patch(':id')
  @RequirePermissions(Permission.ClinicRead)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateVisitTypeDto,
  ) {
    return await this.visitTypes.update(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
      dto,
    );
  }

  @Delete(':id')
  @RequirePermissions(Permission.ClinicRead)
  async deactivate(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.visitTypes.deactivate(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
    );
  }
}
