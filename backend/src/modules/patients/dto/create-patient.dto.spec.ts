import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreatePatientDto } from './create-patient.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreatePatientDto', () => {
  it('accepts a minimal valid patient', async () => {
    await expectValid(CreatePatientDto, {
      fullName: 'Ada Lovelace',
      gender: 'FEMALE',
      dob: '1815-12-10',
      phones: ['+911234567890'],
    });
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

  it('rejects missing gender', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', dob: '1815-12-10', phones: ['+911234567890'] },
      'gender',
    );
  });

  it('rejects missing dob', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'FEMALE', phones: ['+911234567890'] },
      'dob',
    );
  });

  it('rejects empty fullName', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: '', gender: 'FEMALE', dob: '1815-12-10', phones: ['+911234567890'] },
      'fullName',
    );
  });

  it('rejects missing phones', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'FEMALE', dob: '1815-12-10' },
      'phones',
    );
  });

  it('rejects empty phones array', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'FEMALE', dob: '1815-12-10', phones: [] },
      'phones',
    );
  });

  it('rejects unknown gender', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'DRAGON' as any, dob: '1815-12-10', phones: ['+911234567890'] },
      'gender',
    );
  });

  it('rejects malformed email in emails[]', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'FEMALE', dob: '1815-12-10', phones: ['+911234567890'], emails: ['not-an-email'] },
      'emails',
    );
  });

  it('rejects non-mongo primaryBranchId', async () => {
    await expectInvalid(
      CreatePatientDto,
      { fullName: 'Ada', gender: 'FEMALE', dob: '1815-12-10', phones: ['+911234567890'], primaryBranchId: 'x' },
      'primaryBranchId',
    );
  });
});
