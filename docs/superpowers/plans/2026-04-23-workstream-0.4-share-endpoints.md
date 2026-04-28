# Workstream 0.4 — Public share endpoints honor their own schema

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
>
> **Commit discipline:** Per user preference, never run `git commit` without explicit approval. Each task stages and proposes a commit message; wait for user confirmation.

**Goal:** Make public share tokens actually enforce the guarantees their schemas imply. Today `GET /share/:token` and `GET /share/prescriptions/:token` leak through malformed cases (invalid tokens return a 200 body with `{message: 'Invalid token'}`; expired or revoked shares are 404/200 inconsistently; `DocumentShare.maxViews` is ignored; `Prescription` has no expiry/revoke at all). After this workstream, all four failure modes — invalid, revoked, expired, view-limit — produce proper HTTP status codes with no PHI leaking in the body.

**Architecture:** Centralize share logic into the existing services (`DocumentsService`, `PrescriptionsService`) — no new service classes. Add `viewCount: number` to `DocumentShare` and `shareTokenExpiresAt: Date`, `shareTokenRevokedAt: Date` to `Prescription`. Enforce the `maxViews` guard atomically via `findOneAndUpdate` with `$inc: { viewCount: 1 }` and a `$lt` filter so concurrent hits can't oversubscribe. Throw `NotFoundException` for invalid/revoked/expired tokens (indistinguishable to the caller — no existence oracle) and `GoneException` for view-limit exceeded. Controllers become thin wrappers.

**Tech Stack:** NestJS 11 (`NotFoundException`, `GoneException`), Mongoose 9 (`findOneAndUpdate`, `$inc`, `$expr`, `$ifNull`), Jest + `jest.Mocked<Model<T>>` for service tests. No new deps.

**Exit bar:**
- `GET /share/:token` returns 404 for invalid/revoked/expired, 410 for view-limit exceeded, 200 with presigned URL on success. No `{message: '...'}` body on error.
- `GET /share/prescriptions/:token` returns 404 for invalid/revoked/expired, 200 with prescription payload on success.
- `maxViews` guard is atomic (unit test: 5 parallel hits on a share with `maxViews: 3` yield 3 × 200 and 2 × 410, 0 × 500).
- `POST /documents/:id/share/revoke` and `POST /prescriptions/:id/share/revoke` endpoints exist with `document:write` / `patient:write` permissions.
- Prescription share sets a default expiry (7 days, clinic-setting-overridable later).
- Throttler caps are already 10/min per IP on both share routes (workstream 0.1).
- Full test suite green; build clean.

---

## Current state (audit, 2026-04-23)

**Schemas:**
- `DocumentShare` has `clinicId`, `documentId`, `token`, `expiresAt?`, `maxViews?`, `revokedAt?`, `createdBy?`. **Missing:** `viewCount`.
- `Prescription` has `shareToken?`. **Missing:** `shareTokenExpiresAt`, `shareTokenRevokedAt`.

**Documents side — `documents.controller.ts:78-90`:**
```ts
@Get('share/:token')
@Public()
@Throttle({ [THROTTLE_SHARE]: { limit: 10, ttl: 60_000 } })
async shareDownload(@Param('token') token: string, @Query('inline') inline?: string) {
  const share = await this.shareModel.findOne({ token, revokedAt: { $exists: false } });
  if (!share) return { message: 'Invalid token' };                  // 200 + body
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return { message: 'Expired' };  // 200 + body
  const doc = await this.documents.getById(share.clinicId, share.documentId.toHexString());
  const url = await this.storage.presignGet({ key: doc.storageKey });
  return { url, expiresInSeconds: 300, inline: inline === 'true' };
}
```
Share-model access lives in the **controller**, not the service. Move it to `DocumentsService`.

**Prescriptions side — `prescriptions.service.ts:81-85`:**
```ts
async getByShareToken(token: string) {
  const rx = await this.rxModel.findOne({ shareToken: token });
  if (!rx) throw new NotFoundException('Invalid token');
  return rx;
}
```
Does not check expiry or revocation (no such fields yet).

**Share creation:**
- Documents: `documents.controller.ts:56-76` generates a token + `DocumentShare` row with a default 7-day `expiresAt` (optional override). No `viewCount`.
- Prescriptions: `prescriptions.service.ts:72-79` generates a token and stores it on the `Prescription`. No expiry persisted.

---

## File Structure

**Modify:**
- `backend/src/modules/documents/schemas/document-share.schema.ts` — add `viewCount`.
- `backend/src/modules/documents/documents.service.ts` — inject `DocumentShare` model, add `createShare`, `shareDownload`, `revokeShare` methods.
- `backend/src/modules/documents/documents.module.ts` — verify `DocumentShare` is already registered (it is, per controller injection).
- `backend/src/modules/documents/documents.controller.ts` — use service methods; add `POST /documents/:id/share/revoke`; remove direct `shareModel` injection.
- `backend/src/modules/prescriptions/schemas/prescription.schema.ts` — add `shareTokenExpiresAt`, `shareTokenRevokedAt`.
- `backend/src/modules/prescriptions/prescriptions.service.ts` — update `share` to set default expiry; update `getByShareToken` to enforce expiry + revocation; add `revokeShare`.
- `backend/src/modules/prescriptions/prescriptions.controller.ts` — add `POST /prescriptions/:id/share/revoke`.

**Create:**
- `backend/src/modules/documents/documents.service.spec.ts` — share-flow unit tests.
- `backend/src/modules/prescriptions/prescriptions.service.spec.ts` — share-flow unit tests.

---

## Task 1 — Documents share hardening

**Files:**
- Modify: `backend/src/modules/documents/schemas/document-share.schema.ts`
- Modify: `backend/src/modules/documents/documents.service.ts`
- Modify: `backend/src/modules/documents/documents.controller.ts`
- Create: `backend/src/modules/documents/documents.service.spec.ts`

### Step 1.1 — Add `viewCount` to the schema

Replace the full contents of `backend/src/modules/documents/schemas/document-share.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DocumentShareDocument = HydratedDocument<DocumentShare>;

@Schema({ timestamps: true })
export class DocumentShare {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  documentId!: Types.ObjectId;

  @Prop({ required: true, trim: true, index: true })
  token!: string;

  @Prop()
  expiresAt?: Date;

  @Prop()
  maxViews?: number;

  @Prop({ default: 0 })
  viewCount!: number;

  @Prop()
  revokedAt?: Date;

  @Prop({ type: Types.ObjectId })
  createdBy?: Types.ObjectId;
}

export const DocumentShareSchema = SchemaFactory.createForClass(DocumentShare);

DocumentShareSchema.index(
  { token: 1 },
  { unique: true, name: 'doc_share_token_unique' },
);
```

### Step 1.2 — Write failing service tests

Create `backend/src/modules/documents/documents.service.spec.ts`:

```ts
import { GoneException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentsService } from './documents.service';
import { DocumentAccess, DocumentOwnerType } from './schemas/document.schema';

describe('DocumentsService share flow', () => {
  let docModel: any;
  let shareModel: any;
  let service: DocumentsService;

  beforeEach(() => {
    docModel = {
      create: jest.fn(),
      findOne: jest.fn(),
    };
    shareModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    service = new DocumentsService(docModel, shareModel);
  });

  describe('createShare', () => {
    it('creates a share with default 7-day expiry when none provided', async () => {
      const doc = {
        _id: new Types.ObjectId(),
        clinicId: new Types.ObjectId(),
        storageKey: 'k',
      };
      docModel.findOne.mockReturnValue({ exec: async () => doc });
      shareModel.create.mockImplementation(async (input: any) => ({ ...input, _id: new Types.ObjectId() }));

      const result = await service.createShare({
        clinicId: doc.clinicId,
        documentId: doc._id.toHexString(),
        createdBy: new Types.ObjectId(),
      });

      expect(result.token).toMatch(/^[a-f0-9]{48}$/);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
      expect(result.expiresAt.getTime()).toBeLessThan(Date.now() + 8 * 24 * 3600_000);
    });

    it('respects a custom expiresInSeconds', async () => {
      const doc = {
        _id: new Types.ObjectId(),
        clinicId: new Types.ObjectId(),
        storageKey: 'k',
      };
      docModel.findOne.mockReturnValue({ exec: async () => doc });
      shareModel.create.mockImplementation(async (input: any) => ({ ...input, _id: new Types.ObjectId() }));

      const result = await service.createShare({
        clinicId: doc.clinicId,
        documentId: doc._id.toHexString(),
        expiresInSeconds: 3600,
      });

      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3500_000);
      expect(result.expiresAt.getTime()).toBeLessThan(Date.now() + 3700_000);
    });
  });

  describe('shareDownload', () => {
    it('returns the share when atomic guard matches', async () => {
      const share = {
        _id: new Types.ObjectId(),
        clinicId: new Types.ObjectId(),
        documentId: new Types.ObjectId(),
        token: 'good',
        viewCount: 1,
      };
      shareModel.findOneAndUpdate.mockResolvedValue(share);

      const got = await service.shareDownload('good');
      expect(got).toBe(share);
      expect(shareModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
      expect(shareModel.findOne).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown token', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({ exec: async () => null });

      await expect(service.shareDownload('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a revoked token', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({
        exec: async () => ({ token: 't', revokedAt: new Date(), viewCount: 0 }),
      });

      await expect(service.shareDownload('t')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for an expired token', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({
        exec: async () => ({
          token: 't',
          expiresAt: new Date(Date.now() - 1000),
          viewCount: 0,
        }),
      });

      await expect(service.shareDownload('t')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws GoneException when maxViews exceeded', async () => {
      shareModel.findOneAndUpdate.mockResolvedValue(null);
      shareModel.findOne.mockReturnValue({
        exec: async () => ({ token: 't', maxViews: 2, viewCount: 2 }),
      });

      await expect(service.shareDownload('t')).rejects.toBeInstanceOf(GoneException);
    });
  });

  describe('revokeShare', () => {
    it('sets revokedAt atomically when the share exists and is not revoked', async () => {
      const clinicId = new Types.ObjectId();
      const documentId = new Types.ObjectId();
      const share = { _id: new Types.ObjectId(), clinicId, documentId, revokedAt: new Date() };
      shareModel.findOneAndUpdate.mockResolvedValue(share);

      const result = await service.revokeShare(clinicId, documentId.toHexString());
      expect(result).toBe(share);
      expect(shareModel.findOneAndUpdate).toHaveBeenCalledWith(
        { clinicId, documentId, revokedAt: null },
        expect.objectContaining({ $set: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
        { new: true },
      );
    });

    it('throws NotFoundException when no active share exists for the document', async () => {
      const clinicId = new Types.ObjectId();
      const documentId = new Types.ObjectId();
      shareModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.revokeShare(clinicId, documentId.toHexString()))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

### Step 1.3 — Run the spec — expect failures

Run: `cd backend && pnpm test -- documents.service.spec.ts`

Expected: module-or-method-not-found failures — `DocumentsService` does not yet have `createShare`, `shareDownload`, `revokeShare`, and doesn't accept a second constructor argument. Confirm the failure mode.

### Step 1.4 — Rewrite `DocumentsService`

Replace the full contents of `backend/src/modules/documents/documents.service.ts`:

```ts
import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomBytes } from 'crypto';
import {
  Document,
  DocumentAccess,
  DocumentOwnerType,
} from './schemas/document.schema';
import { DocumentShare } from './schemas/document-share.schema';

const DEFAULT_SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(Document.name) private readonly docModel: Model<Document>,
    @InjectModel(DocumentShare.name)
    private readonly shareModel: Model<DocumentShare>,
  ) {}

  async createForOwner(input: {
    clinicId: Types.ObjectId;
    ownerType: DocumentOwnerType;
    ownerId: Types.ObjectId;
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    storageKey: string;
    access?: DocumentAccess;
    createdBy?: Types.ObjectId;
  }) {
    return await this.docModel.create({
      ...input,
      access: input.access ?? DocumentAccess.InternalOnly,
    });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const doc = await this.docModel.findOne({ _id: id, clinicId }).exec();
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async createShare(input: {
    clinicId: Types.ObjectId;
    documentId: string;
    expiresInSeconds?: number;
    maxViews?: number;
    createdBy?: Types.ObjectId;
  }) {
    const doc = await this.docModel
      .findOne({ _id: input.documentId, clinicId: input.clinicId })
      .exec();
    if (!doc) throw new NotFoundException('Document not found');

    const token = randomBytes(24).toString('hex');
    const seconds =
      input.expiresInSeconds && input.expiresInSeconds > 0
        ? input.expiresInSeconds
        : DEFAULT_SHARE_EXPIRY_SECONDS;
    const expiresAt = new Date(Date.now() + seconds * 1000);

    const share = await this.shareModel.create({
      clinicId: input.clinicId,
      documentId: doc._id,
      token,
      expiresAt,
      maxViews: input.maxViews,
      viewCount: 0,
      createdBy: input.createdBy,
    });

    return { _id: share._id, token, expiresAt, maxViews: input.maxViews };
  }

  /**
   * Atomically validate + increment viewCount. Returns the share doc on success.
   * Throws NotFoundException for invalid / revoked / expired tokens.
   * Throws GoneException when maxViews is set and already reached.
   */
  async shareDownload(token: string) {
    const now = new Date();

    const share = await this.shareModel.findOneAndUpdate(
      {
        token,
        revokedAt: null,
        $and: [
          {
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
          },
          {
            $or: [
              { maxViews: { $exists: false } },
              { maxViews: null },
              {
                $expr: {
                  $lt: [{ $ifNull: ['$viewCount', 0] }, '$maxViews'],
                },
              },
            ],
          },
        ],
      },
      { $inc: { viewCount: 1 } },
      { new: true },
    );

    if (share) return share;

    // Disambiguate between 404 and 410.
    const raw = await this.shareModel.findOne({ token }).exec();
    if (!raw) throw new NotFoundException('Invalid token');
    if (raw.revokedAt) throw new NotFoundException('Invalid token');
    if (raw.expiresAt && raw.expiresAt.getTime() <= now.getTime()) {
      throw new NotFoundException('Invalid token');
    }
    if (raw.maxViews != null && (raw.viewCount ?? 0) >= raw.maxViews) {
      throw new GoneException('Share view limit exceeded');
    }
    // Unreachable in normal operation; treat as 404.
    throw new NotFoundException('Invalid token');
  }

  async revokeShare(clinicId: Types.ObjectId, documentId: string) {
    const share = await this.shareModel.findOneAndUpdate(
      {
        clinicId,
        documentId: new Types.ObjectId(documentId),
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
      { new: true },
    );
    if (!share) throw new NotFoundException('Active share not found');
    return share;
  }
}
```

### Step 1.5 — Run the spec — expect pass

Run: `pnpm test -- documents.service.spec.ts`

Expected: all tests pass (13 tests: 2 createShare, 5 shareDownload, 2 revokeShare, plus any others defined above — verify the count matches your spec).

### Step 1.6 — Update `DocumentsController`

Replace the full contents of `backend/src/modules/documents/documents.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { AppRequest } from '../../common/types';
import { RequirePermissions } from '../authz/require-permissions.decorator';
import { Permission } from '../authz/permissions';
import { Public } from '../../common/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { THROTTLE_SHARE } from '../../common/throttler.config';
import { StorageService } from '../storage/storage.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DocumentsService } from './documents.service';
import { Types } from 'mongoose';

@Controller()
export class DocumentsController {
  constructor(
    private readonly storage: StorageService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('documents/upload-url')
  @RequirePermissions(Permission.DocumentWrite)
  async createUploadUrl(@Req() req: AppRequest, @Body() dto: CreateUploadUrlDto) {
    const clinicId = req.context!.clinicId;
    const ownerId = new Types.ObjectId(dto.ownerId);
    const safeName = dto.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const key = `clinic/${clinicId.toHexString()}/${dto.ownerType.toLowerCase()}/${ownerId.toHexString()}/${Date.now()}-${safeName}`;

    const uploadUrl = await this.storage.presignPut({ key, contentType: dto.mimeType });

    const doc = await this.documents.createForOwner({
      clinicId,
      ownerType: dto.ownerType,
      ownerId,
      mimeType: dto.mimeType,
      fileName: dto.fileName,
      sizeBytes: dto.sizeBytes,
      storageKey: key,
      access: dto.access,
      createdBy: req.context!.actorUserId,
    });

    return { documentId: doc._id, storageKey: key, uploadUrl, expiresInSeconds: 300 };
  }

  @Get('documents/:id/download')
  @RequirePermissions(Permission.DocumentRead)
  async download(@Req() req: AppRequest, @Param('id') id: string) {
    const doc = await this.documents.getById(req.context!.clinicId, id);
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300 };
  }

  @Post('documents/:id/share')
  @RequirePermissions(Permission.DocumentWrite)
  async share(
    @Req() req: AppRequest,
    @Param('id') id: string,
    @Body() body: { expiresInSeconds?: number; maxViews?: number },
  ) {
    const out = await this.documents.createShare({
      clinicId: req.context!.clinicId,
      documentId: id,
      expiresInSeconds: body.expiresInSeconds,
      maxViews: body.maxViews,
      createdBy: req.context!.actorUserId,
    });
    return { token: out.token, expiresAt: out.expiresAt, maxViews: out.maxViews };
  }

  @Post('documents/:id/share/revoke')
  @RequirePermissions(Permission.DocumentWrite)
  async revoke(@Req() req: AppRequest, @Param('id') id: string) {
    const out = await this.documents.revokeShare(req.context!.clinicId, id);
    return { revokedAt: out.revokedAt };
  }

  @Get('share/:token')
  @Public()
  @Throttle({ [THROTTLE_SHARE]: { limit: 10, ttl: 60_000 } })
  async shareDownload(@Param('token') token: string, @Query('inline') inline?: string) {
    const share = await this.documents.shareDownload(token);
    const doc = await this.documents.getById(share.clinicId, share.documentId.toHexString());
    const url = await this.storage.presignGet({ key: doc.storageKey });
    return { url, expiresInSeconds: 300, inline: inline === 'true' };
  }
}
```

The controller no longer injects `@InjectModel(DocumentShare.name)` — share-model access lives in the service now. `shareDownload` throws from the service; the errors auto-map to 404/410 via Nest's exception filter.

### Step 1.7 — Verify build

Run: `pnpm build`

Expected: exit 0. If TS complains that `DocumentShare` is registered in the module but unused (since only the service now uses it), ignore — module registration stays; the service consumes it.

### Step 1.8 — Full suite

Run: `pnpm test`

Expected: full suite green. The new service spec adds ~9 tests; other suites unchanged.

### Step 1.9 — Manual smoke (best effort, skip if unreachable)

With a running backend + Mongo + `ALLOW_DEV_AUTH_HEADERS=true`:

```bash
H='-H Content-Type:application/json -H x-clinic-id:507f1f77bcf86cd799439011 -H x-user-id:507f1f77bcf86cd799439011'

# Bogus token → 404
curl -s -o /dev/null -w 'bogus=%{http_code}\n' http://localhost:4000/share/bogus

# Non-revoke against a non-existent document → 404
curl -s -o /dev/null -w 'revoke-none=%{http_code}\n' -X POST $H http://localhost:4000/documents/507f1f77bcf86cd799439011/share/revoke
```

Expected: `bogus=404`, `revoke-none=404`. If unreachable, skip and note reason.

### Step 1.10 — Stage for commit

Stage:
```bash
git add backend/src/modules/documents/
```

Verify `git diff --name-only --cached` lists exactly:
- `backend/src/modules/documents/documents.controller.ts`
- `backend/src/modules/documents/documents.service.ts`
- `backend/src/modules/documents/documents.service.spec.ts`
- `backend/src/modules/documents/schemas/document-share.schema.ts`

Proposed commit message (do NOT apply):

```
fix(documents): harden public share endpoints

Share download now returns 404 for invalid/revoked/expired tokens and
410 when maxViews is reached, instead of returning 200 with an error
message body. maxViews is enforced atomically via findOneAndUpdate +
$inc(viewCount) + $lt guard, so concurrent hits cannot oversubscribe.

Also:
- Adds viewCount field to DocumentShare (default 0).
- Moves share-model access from the controller into DocumentsService.
- Adds POST /documents/:id/share/revoke (requires document:write).
- Share creation accepts optional maxViews alongside expiresInSeconds.
```

---

## Task 2 — Prescriptions share hardening

**Files:**
- Modify: `backend/src/modules/prescriptions/schemas/prescription.schema.ts`
- Modify: `backend/src/modules/prescriptions/prescriptions.service.ts`
- Modify: `backend/src/modules/prescriptions/prescriptions.controller.ts`
- Create: `backend/src/modules/prescriptions/prescriptions.service.spec.ts`

### Step 2.1 — Add expiry + revoke fields to `Prescription`

Replace the full contents of `backend/src/modules/prescriptions/schemas/prescription.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PrescriptionDocument = HydratedDocument<Prescription>;

export type PrescriptionItem = {
  medicineCatalogItemId?: Types.ObjectId;
  customName?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
};

@Schema({ timestamps: true })
export class Prescription {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  clinicId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  branchId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  doctorId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  patientId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  encounterId!: Types.ObjectId;

  @Prop({ type: Array, default: [] })
  items!: PrescriptionItem[];

  @Prop({ trim: true })
  shareToken?: string;

  @Prop()
  shareTokenExpiresAt?: Date;

  @Prop()
  shareTokenRevokedAt?: Date;

  @Prop({ type: Types.ObjectId })
  pdfDocumentId?: Types.ObjectId;
}

export const PrescriptionSchema = SchemaFactory.createForClass(Prescription);

PrescriptionSchema.index(
  { clinicId: 1, patientId: 1, createdAt: -1 },
  { name: 'rx_patient_idx' },
);
PrescriptionSchema.index(
  { shareToken: 1 },
  { sparse: true, name: 'rx_share_token_idx' },
);
```

### Step 2.2 — Write failing service tests

Create `backend/src/modules/prescriptions/prescriptions.service.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PrescriptionsService } from './prescriptions.service';

describe('PrescriptionsService share flow', () => {
  let rxModel: any;
  let encounters: any;
  let service: PrescriptionsService;

  beforeEach(() => {
    rxModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    encounters = { getById: jest.fn() };
    service = new PrescriptionsService(rxModel, encounters);
  });

  function makeRx(overrides: any = {}) {
    return {
      _id: new Types.ObjectId(),
      clinicId: new Types.ObjectId(),
      shareToken: undefined as string | undefined,
      shareTokenExpiresAt: undefined as Date | undefined,
      shareTokenRevokedAt: undefined as Date | undefined,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
      ...overrides,
    };
  }

  describe('share', () => {
    it('sets a token and a default 7-day expiry on first share', async () => {
      const rx = makeRx();
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      const out = await service.share(rx.clinicId, rx._id.toHexString());
      expect(out.shareToken).toMatch(/^[a-f0-9]{48}$/);
      expect(rx.shareToken).toBe(out.shareToken);
      expect(rx.shareTokenExpiresAt).toBeInstanceOf(Date);
      expect(rx.shareTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
      expect(rx.shareTokenExpiresAt!.getTime()).toBeLessThan(Date.now() + 8 * 24 * 3600_000);
      expect(rx.save).toHaveBeenCalled();
    });

    it('reissues token and extends expiry on subsequent share calls', async () => {
      const oldExpiry = new Date(Date.now() + 100_000);
      const rx = makeRx({ shareToken: 'old', shareTokenExpiresAt: oldExpiry });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      const out = await service.share(rx.clinicId, rx._id.toHexString());
      expect(out.shareToken).not.toBe('old');
      expect(rx.shareTokenExpiresAt!.getTime()).toBeGreaterThan(oldExpiry.getTime());
      expect(rx.shareTokenRevokedAt).toBeUndefined();
    });
  });

  describe('getByShareToken', () => {
    it('returns the prescription for a valid, unexpired, non-revoked token', async () => {
      const rx = makeRx({
        shareToken: 'good',
        shareTokenExpiresAt: new Date(Date.now() + 3600_000),
      });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      const got = await service.getByShareToken('good');
      expect(got).toBe(rx);
    });

    it('throws NotFoundException for an unknown token', async () => {
      rxModel.findOne.mockReturnValue({ exec: async () => null });
      await expect(service.getByShareToken('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for an expired token', async () => {
      const rx = makeRx({
        shareToken: 'exp',
        shareTokenExpiresAt: new Date(Date.now() - 1000),
      });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      await expect(service.getByShareToken('exp')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException for a revoked token', async () => {
      const rx = makeRx({
        shareToken: 'rev',
        shareTokenExpiresAt: new Date(Date.now() + 3600_000),
        shareTokenRevokedAt: new Date(Date.now() - 500),
      });
      rxModel.findOne.mockReturnValue({ exec: async () => rx });

      await expect(service.getByShareToken('rev')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('revokeShare', () => {
    it('sets shareTokenRevokedAt and returns the prescription', async () => {
      const clinicId = new Types.ObjectId();
      const rxId = new Types.ObjectId();
      const rx = {
        _id: rxId,
        clinicId,
        shareToken: 't',
        shareTokenRevokedAt: new Date(),
      };
      rxModel.findOneAndUpdate.mockResolvedValue(rx);

      const out = await service.revokeShare(clinicId, rxId.toHexString());
      expect(out).toBe(rx);
      expect(rxModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: rxId.toHexString(), clinicId, shareToken: { $ne: null }, shareTokenRevokedAt: null },
        expect.objectContaining({ $set: expect.objectContaining({ shareTokenRevokedAt: expect.any(Date) }) }),
        { new: true },
      );
    });

    it('throws NotFoundException when prescription has no active share', async () => {
      const clinicId = new Types.ObjectId();
      const rxId = new Types.ObjectId();
      rxModel.findOneAndUpdate.mockResolvedValue(null);

      await expect(service.revokeShare(clinicId, rxId.toHexString()))
        .rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
```

### Step 2.3 — Run the spec — expect failures

Run: `cd backend && pnpm test -- prescriptions.service.spec.ts`

Expected: failures — `revokeShare` doesn't exist yet; `share` and `getByShareToken` don't yet handle expiry/revocation.

### Step 2.4 — Rewrite `PrescriptionsService`

Replace the full contents of `backend/src/modules/prescriptions/prescriptions.service.ts`:

```ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EncountersService } from '../encounters/encounters.service';
import { CreatePrescriptionDto } from './dto/create-prescription.dto';
import { Prescription } from './schemas/prescription.schema';
import { randomBytes } from 'crypto';

const DEFAULT_RX_SHARE_EXPIRY_SECONDS = 7 * 24 * 60 * 60;

@Injectable()
export class PrescriptionsService {
  constructor(
    @InjectModel(Prescription.name)
    private readonly rxModel: Model<Prescription>,
    private readonly encounters: EncountersService,
  ) {}

  async createForEncounter(
    clinicId: Types.ObjectId,
    encounterId: string,
    dto: CreatePrescriptionDto,
  ) {
    const enc = await this.encounters.getById(clinicId, encounterId);

    if (!Array.isArray(dto.items) || dto.items.length === 0) {
      throw new BadRequestException('items is required');
    }

    const items = dto.items.map((it) => {
      const hasCatalog =
        typeof it.medicineCatalogItemId === 'string' &&
        it.medicineCatalogItemId.length > 0;
      const hasCustom =
        typeof it.customName === 'string' && it.customName.trim().length > 0;
      if (!hasCatalog && !hasCustom) {
        throw new BadRequestException(
          'Each item must have medicineCatalogItemId or customName',
        );
      }

      return {
        medicineCatalogItemId: hasCatalog
          ? new Types.ObjectId(it.medicineCatalogItemId)
          : undefined,
        customName: hasCustom ? it.customName!.trim() : undefined,
        dosage: it.dosage?.trim(),
        frequency: it.frequency?.trim(),
        duration: it.duration?.trim(),
        instructions: it.instructions?.trim(),
      };
    });

    return await this.rxModel.create({
      clinicId,
      branchId: enc.branchId,
      doctorId: enc.doctorId,
      patientId: enc.patientId,
      encounterId: enc._id,
      items,
    });
  }

  async getById(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOne({ _id: id, clinicId }).exec();
    if (!rx) throw new NotFoundException('Prescription not found');
    return rx;
  }

  async share(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOne({ _id: id, clinicId }).exec();
    if (!rx) throw new NotFoundException('Prescription not found');

    rx.shareToken = randomBytes(24).toString('hex');
    rx.shareTokenExpiresAt = new Date(
      Date.now() + DEFAULT_RX_SHARE_EXPIRY_SECONDS * 1000,
    );
    rx.shareTokenRevokedAt = undefined;
    await rx.save();

    return {
      id: rx._id,
      shareToken: rx.shareToken,
      shareTokenExpiresAt: rx.shareTokenExpiresAt,
    };
  }

  async getByShareToken(token: string) {
    const rx = await this.rxModel.findOne({ shareToken: token }).exec();
    if (!rx) throw new NotFoundException('Invalid token');
    if (rx.shareTokenRevokedAt) throw new NotFoundException('Invalid token');
    if (
      rx.shareTokenExpiresAt &&
      rx.shareTokenExpiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException('Invalid token');
    }
    return rx;
  }

  async revokeShare(clinicId: Types.ObjectId, id: string) {
    const rx = await this.rxModel.findOneAndUpdate(
      { _id: id, clinicId, shareToken: { $ne: null }, shareTokenRevokedAt: null },
      { $set: { shareTokenRevokedAt: new Date() } },
      { new: true },
    );
    if (!rx) throw new NotFoundException('Active share not found');
    return rx;
  }
}
```

### Step 2.5 — Run the spec — expect pass

Run: `pnpm test -- prescriptions.service.spec.ts`

Expected: all tests green.

### Step 2.6 — Add the revoke endpoint to `PrescriptionsController`

In `backend/src/modules/prescriptions/prescriptions.controller.ts`, add a new handler. Place it after the existing `share` handler (around line 37, right before `getShared`):

```ts
@Post('prescriptions/:id/share/revoke')
@RequirePermissions(Permission.PatientWrite)
async revokeShare(@Req() req: AppRequest, @Param('id') id: string) {
  const out = await this.prescriptions.revokeShare(req.context!.clinicId, id);
  return { shareTokenRevokedAt: out.shareTokenRevokedAt };
}
```

Note: permission is `PatientWrite` to match the existing `@Post('prescriptions/:id/share')` handler's scope (both mutate the same prescription record's share state).

### Step 2.7 — Full suite

Run: `pnpm test`

Expected: full suite green, including the prior document-share spec from Task 1.

### Step 2.8 — Build

Run: `pnpm build` → exit 0.

### Step 2.9 — Stage for commit

Stage:
```bash
git add backend/src/modules/prescriptions/
```

Verify `git diff --name-only --cached` lists exactly:
- `backend/src/modules/prescriptions/prescriptions.controller.ts`
- `backend/src/modules/prescriptions/prescriptions.service.ts`
- `backend/src/modules/prescriptions/prescriptions.service.spec.ts`
- `backend/src/modules/prescriptions/schemas/prescription.schema.ts`

Proposed commit message (do NOT apply):

```
fix(prescriptions): enforce expiry and revocation on share tokens

Adds shareTokenExpiresAt and shareTokenRevokedAt to the Prescription
schema. share() now sets a default 7-day expiry (and reissues both
token and expiry on repeat calls, also clearing any prior revoke).
getByShareToken() rejects invalid / expired / revoked tokens with
NotFoundException so callers get a single 404 regardless of why.

Adds POST /prescriptions/:id/share/revoke (patient:write) which sets
shareTokenRevokedAt atomically and 404s if no active share exists.
```

---

## Task 3 — Final verification + CLAUDE.md

**Files:**
- Modify: `/mnt/Dev/Vidhema/DigiRx/CLAUDE.md`

### Step 3.1 — Full suite

Run: `cd backend && pnpm test`

Expected: full suite green. Record the "Tests: X passed, X total" line.

### Step 3.2 — Build

`pnpm build` → exit 0.

### Step 3.3 — Manual smoke (best effort)

If a backend + Mongo is reachable (see Task 1.9 for setup):

```bash
# Bogus document share token → 404
curl -s -o /dev/null -w 'doc-bogus=%{http_code}\n' http://localhost:4000/share/bogus

# Bogus prescription share token → 404
curl -s -o /dev/null -w 'rx-bogus=%{http_code}\n' http://localhost:4000/share/prescriptions/bogus

# Revoke nonexistent document share → 404
H='-H Content-Type:application/json -H x-clinic-id:507f1f77bcf86cd799439011 -H x-user-id:507f1f77bcf86cd799439011'
curl -s -o /dev/null -w 'doc-revoke=%{http_code}\n' -X POST $H http://localhost:4000/documents/507f1f77bcf86cd799439011/share/revoke

# Revoke nonexistent prescription share → 404
curl -s -o /dev/null -w 'rx-revoke=%{http_code}\n' -X POST $H http://localhost:4000/prescriptions/507f1f77bcf86cd799439011/share/revoke
```

Expected: all four `=404`. If unreachable, skip with the reason.

### Step 3.4 — Update CLAUDE.md

In `/mnt/Dev/Vidhema/DigiRx/CLAUDE.md`, find the "Storage (documents)" section. Add a new line at the end of that section (or a new short section right after):

> Public share endpoints (`GET /share/:token` for documents, `GET /share/prescriptions/:token`) enforce expiry, revocation, and (for documents) `maxViews` in `DocumentsService.shareDownload` / `PrescriptionsService.getByShareToken`. Invalid/expired/revoked → 404; doc-share view limit reached → 410. `maxViews` is enforced atomically via `findOneAndUpdate` + `$inc(viewCount)` + `$lt` guard. Revoke via `POST /documents/:id/share/revoke` (document:write) or `POST /prescriptions/:id/share/revoke` (patient:write).

### Step 3.5 — Stage the CLAUDE.md update

```bash
git add CLAUDE.md
```

Proposed commit message:
```
docs: note share-endpoint hardening in CLAUDE.md
```

### Step 3.6 — Workstream exit-bar checklist

Confirm each roadmap §Phase 0.4 criterion with concrete evidence:

- [ ] `shareDownload` returns 404 for invalid/revoked/expired (cite spec case names).
- [ ] `maxViews` enforced atomically, 410 on excess (cite the test case).
- [ ] Prescription `shareTokenExpiresAt` persisted and enforced (cite schema line + service check).
- [ ] `POST /documents/:id/share/revoke` exists with `document:write` (cite controller line).
- [ ] `POST /prescriptions/:id/share/revoke` exists with `patient:write` (cite controller line).
- [ ] Throttler on share routes is 10/min (already from 0.1; verify `@Throttle` still in place on both routes).

## Report

- **Status:** DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
- Test + build output
- Manual smoke result (or reason skipped)
- Exit-bar checklist with evidence
- Files staged
- Proposed commit message
- Anything surprising

Under 500 words.

---

## Notes for the executing engineer

- **`GoneException` is available from `@nestjs/common`** since NestJS 8. You don't need to define a custom HTTP exception.
- The atomic `findOneAndUpdate` filter for `maxViews` uses `$expr` + `$ifNull` because `maxViews` may be unset on existing shares. The `$ifNull` on `viewCount` handles pre-existing shares that don't yet have the field (the Mongoose schema default of 0 only applies on new inserts).
- The `revokedAt: null` filter matches both fields missing and explicitly null — Mongoose/Mongo treat them equivalently for equality comparisons.
- **Do not** introduce a separate `DocumentShareService` class. The share operations are a small feature of the existing `DocumentsService`; splitting now is premature.
- **Do not** refactor `share` creation to go through `findOneAndUpdate` for atomicity — the document lookup is already scoped by `_id + clinicId` and token generation uses `crypto.randomBytes`, so collisions are effectively impossible. A create is fine.
- **Do not** backfill `viewCount` on existing shares with a migration — the `$ifNull` fallback handles them correctly at read time. A migration can land with the broader migrations workstream (2.5).
- Response shapes for `shareDownload` and `createShare` are additive (`maxViews` is now included when set) — no breaking changes for existing callers.
