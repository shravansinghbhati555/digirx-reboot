import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { TestNotificationDto } from './test-notification.dto';

describe('TestNotificationDto', () => {
  it('accepts a valid SMS test', async () => {
    await expectValid(TestNotificationDto, {
      channel: 'SMS',
      to: '+911234567890',
      body: 'hello',
    });
  });

  it('rejects unknown channel', async () => {
    await expectInvalid(
      TestNotificationDto,
      { channel: 'PIGEON', to: '+911234567890', body: 'hello' },
      'channel',
    );
  });

  it('rejects empty body', async () => {
    await expectInvalid(
      TestNotificationDto,
      { channel: 'SMS', to: '+911234567890', body: '' },
      'body',
    );
  });
});
