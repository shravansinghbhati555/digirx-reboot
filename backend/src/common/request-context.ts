import { Types } from 'mongoose';

export type RequestContext = {
  clinicId: Types.ObjectId;
  branchId?: Types.ObjectId;
  actorUserId?: Types.ObjectId;
};

export function parseObjectId(value: string, fieldName: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return new Types.ObjectId(value);
}

