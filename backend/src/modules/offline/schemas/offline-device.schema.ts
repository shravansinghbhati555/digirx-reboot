import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type OfflineDeviceDocument = HydratedDocument<OfflineDevice>;

/**
 * A device that holds an encrypted offline store, and the unlock code that
 * can open it when the PIN is forgotten.
 *
 * ## Why the server keeps the code
 *
 * The device's data key is wrapped twice — once under the PIN, once under
 * this recovery code. The code itself never stays on the device after it has
 * been uploaded, so a forgotten PIN offline is recoverable only by someone
 * who can read it here (a clinic admin) and read it out over the phone.
 *
 * Holding it in plaintext does not widen exposure: the code only opens the
 * copy of patient data cached on that one tablet, and this database already
 * holds every one of those records.
 */
@Schema({ timestamps: true })
export class OfflineDevice {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  /** `x-device-id` — minted client-side. */
  @Prop({ required: true, trim: true })
  deviceId!: string;

  /** Human name for the device list, e.g. "Dr Rao's tablet". */
  @Prop({ trim: true })
  label?: string;

  @Prop({ required: true, trim: true })
  recoveryCode!: string;

  @Prop({ type: Date, required: true })
  recoveryUpdatedAt!: Date;

  /** Who was signed in when the code was last set. */
  @Prop({ type: Types.ObjectId })
  registeredBy?: Types.ObjectId;
}

export const OfflineDeviceSchema = SchemaFactory.createForClass(OfflineDevice);

OfflineDeviceSchema.index(
  { clinicId: 1, deviceId: 1 },
  { unique: true, name: 'offline_device_unique_idx' },
);
