import { ApproveCashDayDto, SubmitCashCountDto } from './submit-cash-count.dto';
import { expectInvalid, expectValid } from '../../../common/test/dto-validator';

describe('SubmitCashCountDto', () => {
  const ok = { date: '2026-10-12', countedCash: 1500, expectedCash: 1500 };

  it('accepts a count, with or without a client id and note', async () => {
    await expectValid(SubmitCashCountDto, ok);
    await expectValid(SubmitCashCountDto, {
      ...ok,
      _id: '507f1f77bcf86cd799439011',
      note: 'Short by ₹20 — change given',
    });
  });

  it('rejects a date that is not YYYY-MM-DD', async () => {
    await expectInvalid(SubmitCashCountDto, { ...ok, date: '12/10/2026' }, 'date');
  });

  it('rejects a negative count', async () => {
    await expectInvalid(SubmitCashCountDto, { ...ok, countedCash: -1 }, 'countedCash');
  });

  it('rejects fractions of a paisa', async () => {
    await expectInvalid(SubmitCashCountDto, { ...ok, countedCash: 10.005 }, 'countedCash');
  });
});

describe('ApproveCashDayDto', () => {
  it('accepts an empty body', async () => {
    await expectValid(ApproveCashDayDto, {});
  });

  it('rejects an over-long note', async () => {
    await expectInvalid(ApproveCashDayDto, { note: 'x'.repeat(501) }, 'note');
  });
});
