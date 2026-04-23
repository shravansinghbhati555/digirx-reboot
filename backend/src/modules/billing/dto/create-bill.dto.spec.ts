import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateBillDto } from './create-bill.dto';

const ID = '507f1f77bcf86cd799439011';

const validItem = {
  customName: 'Consultation',
  quantity: 1,
  unitPrice: 500,
};

describe('CreateBillDto', () => {
  it('accepts a valid bill', async () => {
    await expectValid(CreateBillDto, {
      branchId: ID,
      patientId: ID,
      items: [validItem],
    });
  });

  it('rejects non-mongo branchId', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: 'x', patientId: ID, items: [validItem] },
      'branchId',
    );
  });

  it('rejects empty items array', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, items: [] },
      'items',
    );
  });

  it('rejects non-positive quantity in item', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, items: [{ ...validItem, quantity: 0 }] },
      'quantity',
    );
  });

  it('rejects negative unitPrice in item', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, items: [{ ...validItem, unitPrice: -1 }] },
      'unitPrice',
    );
  });

  it('rejects non-mongo appointmentId when provided', async () => {
    await expectInvalid(
      CreateBillDto,
      { branchId: ID, patientId: ID, appointmentId: 'x', items: [validItem] },
      'appointmentId',
    );
  });
});
