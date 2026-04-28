import { CreatePaymentDto } from './create-payment.dto';
import { PaymentMethod } from '../schemas/payment.schema';
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';

describe('CreatePaymentDto', () => {
  const base = {
    method: PaymentMethod.Cash,
    amount: 100,
    idempotencyKey: 'abcdefgh',
  };

  it('accepts a minimal valid body', async () => {
    await expectValid(CreatePaymentDto, base);
  });

  it('rejects missing idempotencyKey', async () => {
    const { idempotencyKey: _, ...rest } = base;
    await expectInvalid(CreatePaymentDto, rest, 'idempotencyKey');
  });

  it('rejects idempotencyKey shorter than 8 chars', async () => {
    await expectInvalid(
      CreatePaymentDto,
      { ...base, idempotencyKey: 'short' },
      'idempotencyKey',
    );
  });

  it('rejects idempotencyKey longer than 64 chars', async () => {
    await expectInvalid(
      CreatePaymentDto,
      { ...base, idempotencyKey: 'x'.repeat(65) },
      'idempotencyKey',
    );
  });

  it('accepts a UUIDv4 as idempotencyKey', async () => {
    await expectValid(CreatePaymentDto, {
      ...base,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    });
  });
});
