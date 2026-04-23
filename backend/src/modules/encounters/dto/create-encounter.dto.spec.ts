import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateEncounterDto } from './create-encounter.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreateEncounterDto', () => {
  it('accepts a minimally valid encounter', async () => {
    await expectValid(CreateEncounterDto, {
      branchId: ID,
      doctorId: ID,
      patientId: ID,
    });
  });

  it('rejects non-mongo branchId', async () => {
    await expectInvalid(
      CreateEncounterDto,
      { branchId: 'x', doctorId: ID, patientId: ID },
      'branchId',
    );
  });

  it('rejects non-ISO visitedAt', async () => {
    await expectInvalid(
      CreateEncounterDto,
      { branchId: ID, doctorId: ID, patientId: ID, visitedAt: 'now' },
      'visitedAt',
    );
  });

  it('rejects non-mongo appointmentId when provided', async () => {
    await expectInvalid(
      CreateEncounterDto,
      { branchId: ID, doctorId: ID, patientId: ID, appointmentId: 'x' },
      'appointmentId',
    );
  });
});
