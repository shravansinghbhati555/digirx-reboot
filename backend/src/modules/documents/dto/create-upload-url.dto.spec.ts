import { expectInvalid, expectValid } from '../../../common/test/dto-validator';
import { CreateUploadUrlDto } from './create-upload-url.dto';

const ID = '507f1f77bcf86cd799439011';

describe('CreateUploadUrlDto', () => {
  it('accepts a valid upload request', async () => {
    await expectValid(CreateUploadUrlDto, {
      ownerType: 'PATIENT',
      ownerId: ID,
      fileName: 'scan.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });
  });

  it('rejects unknown ownerType', async () => {
    await expectInvalid(
      CreateUploadUrlDto,
      { ownerType: 'BOGUS', ownerId: ID, fileName: 'x', mimeType: 'x', sizeBytes: 1 },
      'ownerType',
    );
  });

  it('rejects non-mongo ownerId', async () => {
    await expectInvalid(
      CreateUploadUrlDto,
      { ownerType: 'PATIENT', ownerId: 'x', fileName: 'x', mimeType: 'x', sizeBytes: 1 },
      'ownerId',
    );
  });

  it('rejects zero or negative sizeBytes', async () => {
    await expectInvalid(
      CreateUploadUrlDto,
      { ownerType: 'PATIENT', ownerId: ID, fileName: 'x', mimeType: 'x', sizeBytes: 0 },
      'sizeBytes',
    );
  });
});
