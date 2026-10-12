import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { OfflineDevice } from './schemas/offline-device.schema';

export type OfflineDeviceView = {
  deviceId: string;
  label?: string;
  recoveryCode: string;
  recoveryUpdatedAt: Date;
  registeredBy?: string;
};

/**
 * Registry of devices holding an encrypted offline store — the server half
 * of the "clinic admin unlock code" (ticket A4/P6).
 */
@Injectable()
export class OfflineDeviceService {
  constructor(
    @InjectModel(OfflineDevice.name)
    private readonly deviceModel: Model<OfflineDevice>,
  ) {}

  /**
   * Record (or replace) a device's unlock code. Replacing is the normal path:
   * a code that has been read out over the phone is rotated by the device
   * right after it is used.
   */
  async setRecoveryCode(input: {
    clinicId: Types.ObjectId;
    deviceId: string;
    recoveryCode: string;
    label?: string;
    actorUserId?: Types.ObjectId;
  }): Promise<{ ok: true }> {
    await this.deviceModel.findOneAndUpdate(
      { clinicId: input.clinicId, deviceId: input.deviceId },
      {
        $set: {
          recoveryCode: input.recoveryCode,
          recoveryUpdatedAt: new Date(),
          ...(input.label ? { label: input.label } : {}),
          ...(input.actorUserId ? { registeredBy: input.actorUserId } : {}),
        },
      },
      { upsert: true, new: true },
    );
    // Never echo the code back — the device already has it.
    return { ok: true };
  }

  async list(clinicId: Types.ObjectId): Promise<OfflineDeviceView[]> {
    const rows = await this.deviceModel
      .find({ clinicId })
      .sort({ recoveryUpdatedAt: -1 })
      .lean();
    return rows.map((r) => ({
      deviceId: r.deviceId,
      label: r.label,
      recoveryCode: r.recoveryCode,
      recoveryUpdatedAt: r.recoveryUpdatedAt,
      registeredBy: r.registeredBy?.toHexString(),
    }));
  }
}
