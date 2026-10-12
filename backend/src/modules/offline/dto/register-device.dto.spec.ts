import { RegisterDeviceRecoveryDto } from './register-device.dto';
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';

describe('RegisterDeviceRecoveryDto', () => {
  it('accepts a well-formed code and label', async () => {
    await expectValid(RegisterDeviceRecoveryDto, {
      recoveryCode: 'ABCD-EFGH-JK23-MN45',
      label: 'Front desk tablet',
    });
  });

  it('rejects a code in the wrong shape', async () => {
    await expectInvalid(RegisterDeviceRecoveryDto, { recoveryCode: 'abcd-1234' }, 'recoveryCode');
  });

  it('rejects a missing code', async () => {
    await expectInvalid(RegisterDeviceRecoveryDto, {}, 'recoveryCode');
  });
});
