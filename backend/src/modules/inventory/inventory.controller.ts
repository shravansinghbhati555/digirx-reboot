import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { Permission } from '../authz/permissions';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { DispenseStockDto } from './dto/dispense-stock.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { InventoryFeatureGuard } from './inventory.guard';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(InventoryFeatureGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  // -- items ---------------------------------------------------------------

  @Post('items')
  @RequirePermissions(Permission.InventoryWrite)
  async create(@Req() req: AppRequest, @Body() dto: CreateInventoryItemDto) {
    return await this.inventory.createItem(req.context!.clinicId, dto);
  }

  @Patch('items/:id')
  @RequirePermissions(Permission.InventoryWrite)
  async update(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return await this.inventory.updateItem(req.context!.clinicId, id, dto);
  }

  @Get('items')
  @RequirePermissions(Permission.InventoryRead)
  async list(
    @Req() req: AppRequest,
    @Query('branchId') branchId?: string,
    @Query('query') query?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return await this.inventory.searchItems(req.context!.clinicId, {
      branchId,
      query,
      limit,
    });
  }

  @Get('items/:id')
  @RequirePermissions(Permission.InventoryRead)
  async get(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.inventory.getItem(req.context!.clinicId, id);
  }

  // -- movement ------------------------------------------------------------

  @Post('items/:id/batches')
  @RequirePermissions(Permission.InventoryWrite)
  async receive(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: ReceiveStockDto,
  ) {
    return await this.inventory.receiveStock(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
      dto,
    );
  }

  @Get('items/:id/batches')
  @RequirePermissions(Permission.InventoryRead)
  async listBatches(@Req() req: AppRequest, @Param('id') id: string) {
    return await this.inventory.listBatches(req.context!.clinicId, id);
  }

  @Post('items/:id/dispense')
  @RequirePermissions(Permission.InventoryWrite)
  async dispense(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: DispenseStockDto,
  ) {
    return await this.inventory.dispenseStock(
      req.context!.clinicId,
      req.context!.actorUserId,
      id,
      dto,
    );
  }

  @Get('items/:id/movements')
  @RequirePermissions(Permission.InventoryRead)
  async movements(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Query('limit') limitRaw?: string,
    @Query('before') before?: string,
  ) {
    const limit = Number(limitRaw ?? 50) || 50;
    return await this.inventory.listMovements(req.context!.clinicId, id, {
      limit,
      before,
    });
  }

  // -- reports -------------------------------------------------------------

  @Get('low-stock')
  @RequirePermissions(Permission.InventoryRead)
  async lowStock(@Req() req: AppRequest, @Query('branchId') branchId?: string) {
    return await this.inventory.listLowStock(req.context!.clinicId, { branchId });
  }

  @Get('expiring')
  @RequirePermissions(Permission.InventoryRead)
  async expiring(
    @Req() req: AppRequest,
    @Query('branchId') branchId?: string,
    @Query('daysAhead') daysAheadRaw?: string,
  ) {
    const daysAhead = daysAheadRaw ? Number(daysAheadRaw) : undefined;
    return await this.inventory.listExpiring(req.context!.clinicId, {
      branchId,
      daysAhead,
    });
  }
}
