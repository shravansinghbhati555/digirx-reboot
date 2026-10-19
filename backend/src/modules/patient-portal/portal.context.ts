import { Types } from 'mongoose';
import type { AppRequest } from '../../common/types';
import type { PatientAccountDocument } from '../patient-identities/schemas/patient-account.schema';

/**
 * Authenticated portal caller. Lives on `req.portal`, never on
 * `req.context` — so no staff guard, interceptor or middleware treats a
 * patient as a clinic user.
 */
export type PortalCtx = {
  accountId: Types.ObjectId;
  account: PatientAccountDocument;
  /** Clinics whose data this request read or changed, for their access logs. */
  touched: Set<string>;
  ip?: string;
  userAgent?: string;
};

export type PortalRequest = AppRequest & { portal?: PortalCtx };

export function touch(ctx: PortalCtx, clinicId: Types.ObjectId | string) {
  ctx.touched.add(String(clinicId));
}
