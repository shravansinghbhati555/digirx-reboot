import { ArgumentsHost, ConflictException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { expectInvalid, expectValid } from '../../common/test/dto-validator';
import {
  CLIENT_ID_EXISTS,
  clientIdFields,
  isDuplicateIdError,
  resolveClientId,
} from './client-id.util';
import { ClientIdDto } from './dto/client-id.dto';
import { ClientIdConflictFilter } from './filters/client-id-conflict.filter';
import { CreateAppointmentDto } from '../appointments/dto/create-appointment.dto';
import { CreateBillDto } from '../billing/dto/create-bill.dto';
import { CreateEncounterDto } from '../encounters/dto/create-encounter.dto';
import { CreatePatientDto } from '../patients/dto/create-patient.dto';
import { CreatePrescriptionDto } from '../prescriptions/dto/create-prescription.dto';

const ID = '507f1f77bcf86cd799439011';

/**
 * Assert no validation error landed on `prop`, ignoring failures elsewhere.
 * Lets us check inherited `_id` handling without building a fully valid body
 * for every DTO under test.
 */
async function expectNoErrorOn<T extends object>(
  Cls: new (...args: any[]) => T,
  plain: unknown,
  prop: string,
): Promise<void> {
  const errors = await validate(plainToInstance(Cls, plain) as object);
  const hit = errors.find((e) => e.property === prop);
  if (hit) {
    throw new Error(
      `Expected no validation error on "${prop}", got: ${JSON.stringify(hit, null, 2)}`,
    );
  }
}

describe('ClientIdDto', () => {
  it('accepts a valid ObjectId as _id', async () => {
    await expectValid(ClientIdDto, { _id: ID });
  });

  it('accepts an omitted _id — online clients still let the server mint', async () => {
    await expectValid(ClientIdDto, {});
  });

  it('rejects a non-ObjectId _id', async () => {
    await expectInvalid(ClientIdDto, { _id: 'not-an-object-id' }, '_id');
  });

  it('rejects a numeric _id', async () => {
    await expectInvalid(ClientIdDto, { _id: 12345 }, '_id');
  });
});

describe('offline-creatable DTOs inherit _id validation', () => {
  const dtos: Array<[string, new (...args: any[]) => object]> = [
    ['CreatePatientDto', CreatePatientDto],
    ['CreateAppointmentDto', CreateAppointmentDto],
    ['CreateEncounterDto', CreateEncounterDto],
    ['CreatePrescriptionDto', CreatePrescriptionDto],
    ['CreateBillDto', CreateBillDto],
  ];

  it.each(dtos)('%s rejects a malformed _id', async (_name, Cls) => {
    await expectInvalid(Cls, { _id: 'nope' }, '_id');
  });

  it.each(dtos)('%s accepts a well-formed _id', async (_name, Cls) => {
    await expectNoErrorOn(Cls, { _id: ID }, '_id');
  });

  it.each(dtos)('%s accepts an absent _id', async (_name, Cls) => {
    await expectNoErrorOn(Cls, {}, '_id');
  });
});

describe('resolveClientId / clientIdFields', () => {
  it('returns undefined when no id was supplied', () => {
    expect(resolveClientId(undefined)).toBeUndefined();
  });

  it('parses a hex string into an ObjectId', () => {
    const out = resolveClientId(ID);
    expect(out).toBeInstanceOf(Types.ObjectId);
    expect(out?.toHexString()).toBe(ID);
  });

  it('omits the _id key entirely when absent, so Mongoose applies its default', () => {
    const fields = clientIdFields(undefined);
    expect(Object.prototype.hasOwnProperty.call(fields, '_id')).toBe(false);
  });

  it('includes the _id key when supplied', () => {
    expect(clientIdFields(ID)._id?.toHexString()).toBe(ID);
  });
});

describe('isDuplicateIdError', () => {
  it('matches a duplicate key on the _id index', () => {
    expect(isDuplicateIdError({ code: 11000, keyPattern: { _id: 1 } })).toBe(true);
  });

  it('ignores a duplicate key on some other index', () => {
    // e.g. appt_queue_unique_idx — that is a real conflict, not a replay,
    // and must keep its own error handling.
    expect(
      isDuplicateIdError({ code: 11000, keyPattern: { clinicId: 1, queueDate: 1 } }),
    ).toBe(false);
  });

  it('ignores non-duplicate errors', () => {
    expect(isDuplicateIdError(new Error('boom'))).toBe(false);
    expect(isDuplicateIdError(null)).toBe(false);
  });
});

describe('ClientIdConflictFilter', () => {
  const dupErr = { code: 11000, keyPattern: { _id: 1 } };
  let filter: ClientIdConflictFilter;
  let superCatch: jest.SpyInstance;

  function hostWith(body: unknown, path = '/patients'): ArgumentsHost {
    return {
      switchToHttp: () => ({ getRequest: () => ({ body, path }) }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    // The filter delegates everything to BaseExceptionFilter; spying on it
    // lets us assert the decision without standing up an HTTP adapter.
    superCatch = jest
      .spyOn(BaseExceptionFilter.prototype, 'catch')
      .mockImplementation(() => undefined);
    filter = new ClientIdConflictFilter();
  });

  afterEach(() => jest.restoreAllMocks());

  it('maps a duplicate _id onto a 409 carrying CLIENT_ID_EXISTS', () => {
    filter.catch(dupErr, hostWith({ _id: ID }));

    const passed = superCatch.mock.calls[0][0] as ConflictException;
    expect(passed).toBeInstanceOf(ConflictException);
    const body = passed.getResponse() as Record<string, unknown>;
    expect(body.code).toBe(CLIENT_ID_EXISTS);
    expect(body.entity).toBe('patient');
    expect(body._id).toBe(ID);
  });

  it('names the entity from the route', () => {
    filter.catch(dupErr, hostWith({ _id: ID }, '/bills'));
    const body = (
      superCatch.mock.calls[0][0] as ConflictException
    ).getResponse() as Record<string, unknown>;
    expect(body.entity).toBe('bill');
  });

  it('falls back to a generic entity name for an unmapped route', () => {
    filter.catch(dupErr, hostWith({ _id: ID }, '/something-else'));
    const body = (
      superCatch.mock.calls[0][0] as ConflictException
    ).getResponse() as Record<string, unknown>;
    expect(body.entity).toBe('record');
  });

  it('does not claim a conflict when the client supplied no id', () => {
    // A duplicate _id with no client id is a genuine server-side collision,
    // which should not be dressed up as a replay.
    filter.catch(dupErr, hostWith({ fullName: 'Ada' }));
    expect(superCatch).toHaveBeenCalledWith(dupErr, expect.anything());
  });

  it('passes other errors through untouched', () => {
    const other = new Error('validation failed');
    filter.catch(other, hostWith({ _id: ID }));
    expect(superCatch).toHaveBeenCalledWith(other, expect.anything());
  });

  it('passes a duplicate on another index through untouched', () => {
    const queueDup = { code: 11000, keyPattern: { clinicId: 1, queueDate: 1 } };
    filter.catch(queueDup, hostWith({ _id: ID }, '/appointments'));
    expect(superCatch).toHaveBeenCalledWith(queueDup, expect.anything());
  });

  it('survives a request with no body at all', () => {
    expect(() => filter.catch(dupErr, hostWith(undefined))).not.toThrow();
    expect(superCatch).toHaveBeenCalledWith(dupErr, expect.anything());
  });
});
