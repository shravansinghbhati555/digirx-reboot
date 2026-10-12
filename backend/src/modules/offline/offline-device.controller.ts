import { BadRequestException, Body, Controller, Get, Put, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { OfflineDeviceService } from './offline-device.service';
import { RegisterDeviceRecoveryDto } from './dto/register-device.dto';

@Controller('offline/devices')
export class OfflineDeviceController {
  constructor(private readonly devices: OfflineDeviceService) {}

  /**
   * A device registers its own unlock code. Any signed-in user may do this
   * for the device they are on — the device id comes from `x-device-id`,
   * never the body, so one tablet cannot overwrite another's code.
   */
  @Put('me/recovery-code')
  @RequirePermissions()
  async setRecoveryCode(@Req() req: AppRequest, @Body() dto: RegisterDeviceRecoveryDto) {
    const deviceId = req.context!.deviceId;
    if (!deviceId) throw new BadRequestException('Send x-device-id');
    return await this.devices.setRecoveryCode({
      clinicId: req.context!.clinicId,
      deviceId,
      recoveryCode: dto.recoveryCode,
      label: dto.label,
      actorUserId: req.context!.actorUserId,
    });
  }

  /** Every device in the clinic with its current unlock code. Admin only. */
  @Get()
  @RequirePermissions(Permission.DeviceManage)
  async list(@Req() req: AppRequest) {
    return await this.devices.list(req.context!.clinicId);
  }
}
