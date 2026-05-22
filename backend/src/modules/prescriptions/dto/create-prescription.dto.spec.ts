import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreatePrescriptionDto } from './create-prescription.dto';

describe('CreatePrescriptionDto', () => {
  it('accepts a valid prescription with one custom-name item', async () => {
    await expectValid(CreatePrescriptionDto, {
      items: [{ customName: 'Amoxicillin 500mg', dosage: '1 tab', frequency: 'TID', duration: '5d' }],
    });
  });

  it('rejects empty items', async () => {
    await expectInvalid(CreatePrescriptionDto, { items: [] }, 'items');
  });

  it('rejects non-string customName in item', async () => {
    await expectInvalid(
      CreatePrescriptionDto,
      { items: [{ customName: 123 as unknown as string }] },
      'customName',
    );
  });

  it('rejects non-mongo medicineCatalogItemId in item', async () => {
    await expectInvalid(
      CreatePrescriptionDto,
      { items: [{ medicineCatalogItemId: 'x', customName: 'X' }] },
      'medicineCatalogItemId',
    );
  });

  it('rejects special characters in customName in item', async () => {
    await expectInvalid(
      CreatePrescriptionDto,
      { items: [{ customName: 'Amox@cillin!' }] },
      'customName',
    );
    await expectInvalid(
      CreatePrescriptionDto,
      { items: [{ customName: 'Crocin %' }] },
      'customName',
    );
  });
});
