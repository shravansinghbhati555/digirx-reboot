import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { NumberLeaseService } from './number-lease.service';
import { IssueLeaseDto, ReportLeaseUsageDto } from './dto/issue-lease.dto';
import { LeaseCounter } from './schemas/number-lease.schema';
import { Types } from 'mongoose';

/**
 * Number leases — ticket C1.
 *
 * A device asks for a block of sequence numbers while it still has a
 * connection, then draws from that block during an outage. See
 * `schemas/number-lease.schema.ts` for why blocks rather than per-device
 * prefixes, and why the allocation is safe.
 */
@Controller('offline/leases')
export class NumberLeaseController {
  constructor(private readonly leases: NumberLeaseService) {}

  /**
   * Leasing a number is the same act as being allowed to create the thing it
   * will name, so each counter is gated on that entity's write permission
   * rather than inventing an offline-specific one.
   */
  private permissionFor(counter: LeaseCounter): Permission {
    switch (counter) {
      case LeaseCounter.Mrn:
        return Permission.PatientWrite;
      case LeaseCounter.Prescription:
        return Permission.PatientWrite;
      case LeaseCounter.Bill:
        return Permission.BillingWrite;
    }
  }

  @Post()
  // Coarse gate here; the per-counter permission is enforced below, because
  // the guard cannot see the request body.
  @RequirePermissions(Permission.PatientWrite)
  async issue(@Req() req: AppRequest, @Body() dto: IssueLeaseDto) {
    const deviceId = req.context!.deviceId;
    if (!deviceId) {
      throw new BadRequestException(
        'Send x-device-id — leases are held by a device, not a user',
      );
    }
    this.assertPermitted(req, dto.counter);

    return await this.leases.issue({
      clinicId: req.context!.clinicId,
      branchId: dto.branchId
        ? new Types.ObjectId(dto.branchId)
        : req.context!.branchId,
      deviceId,
      counter: dto.counter,
      size: dto.size,
      actorUserId: req.context!.actorUserId,
    });
  }

  @Get()
  @RequirePermissions(Permission.PatientWrite)
  async list(@Req() req: AppRequest) {
    const deviceId = req.context!.deviceId;
    if (!deviceId) throw new BadRequestException('Send x-device-id');
    return await this.leases.listForDevice(req.context!.clinicId, deviceId);
  }

  @Post(':id/usage')
  @RequirePermissions(Permission.PatientWrite)
  async reportUsage(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() dto: ReportLeaseUsageDto,
  ) {
    const deviceId = req.context!.deviceId;
    if (!deviceId) throw new BadRequestException('Send x-device-id');
    return await this.leases.reportUsage(
      req.context!.clinicId,
      deviceId,
      id,
      dto.usedThrough,
    );
  }

  @Post(':id/release')
  @RequirePermissions(Permission.PatientWrite)
  async release(@Req() req: AppRequest, @Param('id') id: string) {
    const deviceId = req.context!.deviceId;
    if (!deviceId) throw new BadRequestException('Send x-device-id');
    await this.leases.release(req.context!.clinicId, deviceId, id);
    return { ok: true };
  }

  /**
   * The global `PermissionsGuard` reads static metadata, so it cannot gate on
   * a value that only exists in the body. A BILL lease needs `billing:write`,
   * which `patient:write` alone must not grant.
   */
  private assertPermitted(req: AppRequest, counter: LeaseCounter): void {
    const needed = this.permissionFor(counter);
    if (needed === Permission.PatientWrite) return; // already enforced by the guard
    const held = req.actorPermissions;
    if (!held || !held.has(needed)) {
      throw new ForbiddenException(`Missing permission: ${needed}`);
    }
  }
}
