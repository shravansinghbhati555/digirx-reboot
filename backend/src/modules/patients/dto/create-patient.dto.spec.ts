import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreatePatientDto } from './create-patient.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreatePatientDto', () => {
  it('accepts a minimal valid patient', async () => {
    await expectValid(CreatePatientDto, { fullName: 'Ada Lovelace' });
  });

  it('accepts a full patient', async () => {
    await expectValid(CreatePatientDto, {
      fullName: 'Ada Lovelace',
      gender: 'FEMALE',
      dob: '1815-12-10',
      phones: ['+911234567890'],
      emails: ['ada@example.com'],
      primaryBranchId: ID,
      tags: ['vip'],
      notes: 'Long-term patient',
    });
  });

  it('rejects empty fullName', async () => {
    await expectInvalid(CreatePatientDto, { fullName: '' }, 'fullName');
  });

  it('rejects unknown gender', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'DRAGON' },
      'gender',
    );
  });

  it('rejects malformed email in emails[]', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', emails: ['not-an-email'] },
      'emails',
    );
  });

  it('rejects non-mongo primaryBranchId', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', primaryBranchId: 'x' },
      'primaryBranchId',
    );
  });
});
