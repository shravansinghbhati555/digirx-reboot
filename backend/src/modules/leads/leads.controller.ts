import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/public.decorator';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { PlatformAdminGuard } from '../platform/platform-admin.guard';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

/**
 * Public intake for the marketing site's contact form.
 *
 * Unauthenticated by necessity — the visitor has no account — so it is rate
 * limited per IP. Nothing here is clinic-scoped: a lead arrives before any
 * clinic exists.
 */
@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Post()
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@Body() body: CreateLeadDto) {
    return this.leads.create(body);
  }
}

/**
 * The sales inbox, for DigiRx staff only.
 *
 * Same pairing as the clinic approval queue: `@RequirePermissions()` with no
 * arguments satisfies the global default-deny guard, then PlatformAdminGuard
 * does the real check.
 */
@Controller('platform/leads')
@RequirePermissions()
@UseGuards(PlatformAdminGuard)
export class PlatformLeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get('summary')
  async summary() {
    return this.leads.summary();
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('query') query?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return this.leads.list({ status, query, limit });
  }

  @Patch(':id')
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: UpdateLeadDto,
  ) {
    return this.leads.update(id, req.context!.actorUserId!, body);
  }
}
