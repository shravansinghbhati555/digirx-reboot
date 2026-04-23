import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateAppointmentDto } from './create-appointment.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreateAppointmentDto', () => {
  it('accepts a valid TIME appointment', async () => {
    await expectValid(CreateAppointmentDto, {
      type: 'TIME',
      branchId: ID,
      doctorId: ID,
      patientId: ID,
      startAt: '2026-05-01T10:00:00.000Z',
      endAt: '2026-05-01T10:15:00.000Z',
    });
  });

  it('accepts a valid QUEUE appointment', async () => {
    await expectValid(CreateAppointmentDto, {
      type: 'QUEUE',
      branchId: ID,
      doctorId: ID,
      patientId: ID,
      queueDate: '2026-05-01',
    });
  });

  it('rejects an unknown type', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      { type: 'BOGUS', branchId: ID, doctorId: ID, patientId: ID },
      'type',
    );
  });

  it('rejects non-mongo branchId', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      { type: 'TIME', branchId: 'not-an-id', doctorId: ID, patientId: ID },
      'branchId',
    );
  });

  it('rejects non-ISO startAt', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      {
        type: 'TIME',
        branchId: ID,
        doctorId: ID,
        patientId: ID,
        startAt: 'yesterday',
        endAt: '2026-05-01T10:15:00.000Z',
      },
      'startAt',
    );
  });

  it('rejects malformed queueDate', async () => {
    await expectInvalid(
      CreateAppointmentDto,
      { type: 'QUEUE', branchId: ID, doctorId: ID, patientId: ID, queueDate: '05/01/2026' },
      'queueDate',
    );
  });
});
