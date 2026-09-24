import { ArgumentsHost, Catch, ConflictException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { CLIENT_ID_EXISTS, isDuplicateIdError } from '../client-id.util';

/**
 * Route segment → entity name for the 409 body. Falls back to `record`, so an
 * unmapped route still produces a sane message rather than an ugly one.
 */
const ENTITY_BY_SEGMENT: Record<string, string> = {
  patients: 'patient',
  appointments: 'appointment',
  encounters: 'encounter',
  prescriptions: 'prescription',
  bills: 'bill',
};

function entityFromRequest(req: Request | undefined): string {
  const segment = (req?.path ?? '').split('/').filter(Boolean)[0] ?? '';
  return ENTITY_BY_SEGMENT[segment] ?? 'record';
}

/**
 * Translates a duplicate-`_id` write into a 409 carrying a machine-readable
 * code, globally, so no feature service needs its own try/catch.
 *
 * In practice a collision is not really a collision — ObjectIds do not
 * realistically clash — it is the offline write queue replaying a create that
 * already landed. The replay engine keys on `code` to mark that queue entry
 * done instead of parking it in the failure surface.
 *
 * We still reject rather than silently returning the existing row: a buggy or
 * hostile client must not be able to adopt another record by guessing its id.
 *
 * The filter only fires when the request body actually carried an `_id`. A
 * duplicate `_id` with no client-supplied id is a genuine server-side
 * collision and must not be dressed up as a replay, so it falls through to
 * the default handling. Everything else is delegated to `BaseExceptionFilter`
 * untouched.
 */
@Catch()
export class ClientIdConflictFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const clientId = (req?.body as { _id?: unknown } | undefined)?._id;

    if (typeof clientId === 'string' && isDuplicateIdError(exception)) {
      const entity = entityFromRequest(req);
      return super.catch(
        new ConflictException({
          statusCode: 409,
          code: CLIENT_ID_EXISTS,
          entity,
          _id: clientId,
          message: `A ${entity} with _id ${clientId} already exists`,
        }),
        host,
      );
    }

    return super.catch(exception, host);
  }
}
