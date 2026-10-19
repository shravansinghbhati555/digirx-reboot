import { Controller, Get, Param, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { RecordAccessService } from './record-access.service';

/**
 * Clinic-facing (staff) read of a patient's records from other DigiRx
 * clinics. Returns `{ shared: false }` unless the patient has explicitly
 * shared them with this clinic from the portal.
 */
@Controller('patients')
export class RecordAccessController {
  constructor(private readonly recordAccess: RecordAccessService) {}

  @Get(':id/shared-records')
  @RequirePermissions(Permission.PatientRead)
  async sharedRecords(@Req() req: AppRequest, @Param('id') id: string) {
    return this.recordAccess.sharedRecordsForClinic(
      req.context!.clinicId,
      id,
      req.context!.actorUserId,
    );
  }
}
