import { Controller, Get, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';

@Controller('doctors')
export class DoctorAvailabilityController {
  @Get('availability')
  async availability(@Req() req: AppRequest, @Query('doctorId') doctorId: string, @Query('from') from: string, @Query('to') to: string, @Query('branchId') branchId: string) {
    // Placeholder endpoint. Next iteration will enforce availability rules from config.
    // For now, we simply echo request and report "available".
    return {
      clinicId: req.context!.clinicId.toHexString(),
      branchId,
      doctorId,
      from,
      to,
      available: true,
      slots: [],
    };
  }
}

