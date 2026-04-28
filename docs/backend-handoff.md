# DigiRx Backend — Developer Handoff

> **Status (April 2026):** ~Phase 0.5 of the 4-phase production roadmap. Foundation hardening is in progress; Phase-1 product workflows are partially implemented. This document is the single source of truth for handing the backend to a new engineer.
>
> **Authoritative source documents (do not duplicate, link out):**
> - `clinic-management-implementation-plan.md` — original product/requirements spec.
> - `docs/production-roadmap.md` — forward plan, workstream definitions, exit bars.
> - `CLAUDE.md` — codebase conventions and critical correctness paths.

---

## 1. Executive Summary

DigiRx is a **multi-tenant, multi-branch clinic management platform**. One backend serves many clinics; every operational record carries a `clinicId` and most carry a `branchId`. The product covers patient management, appointment scheduling (time-slot and queue-token), consultations and prescriptions, itemized billing with payments, document storage with public share links, role-based access, audit logging, and SMS/WhatsApp reminders.

Architecture is a **modular NestJS monolith** on MongoDB with Redis-backed BullMQ for async work and S3-compatible object storage for documents. Frontend is a separate React + Vite SPA (mobile-first; currently a developer console).

Phase-0 hardening (auth lockdown, DTO validation, timezone correctness, share endpoints, idempotent payments) is largely complete. Core workflows (encounters, prescriptions PDFs, billing PDFs, notifications scheduler) exist as functional skeletons. The remaining work — tracked in the production roadmap — is admin CRUD, full doctor/billing UX, real notification providers, reporting, observability, and operational/CI/CD readiness.

---

## 2. Tech Stack

| Layer | Choice | Version |
|---|---|---|
| Runtime | Node.js | 20+ (target ES2023) |
| Language | TypeScript (strict) | 5.7 |
| Framework | NestJS | 11 |
| HTTP adapter | Express + cookie-parser + multer | — |
| Database | MongoDB (Mongoose) | Mongo 7 / Mongoose 9 |
| Cache / Queue | Redis + BullMQ | Redis 7 / BullMQ 5 |
| Object storage | S3-compatible (MinIO in dev) | AWS SDK v3 |
| Auth | JWT access + httpOnly refresh cookie + Passport-JWT | bcrypt-hashed creds & refresh |
| Validation | class-validator + class-transformer | — |
| Date/time | Luxon | 3.7 |
| PDF | pdf-lib | 1.17 |
| Scheduling | @nestjs/schedule (cron) | 6.1 |
| Rate limiting | @nestjs/throttler | 6 |
| Tests | Jest + ts-jest + supertest | Jest 30 |
| Lint/format | ESLint 9 (typescript-eslint) + Prettier | — |
| Package manager | **pnpm** (do not introduce npm/yarn lockfiles) | — |

---

## 3. Repository Layout

```
DigiRx/
├── backend/                  NestJS API (port 4000)
│   ├── src/
│   │   ├── main.ts           bootstrap, global pipes/guards/interceptors, CORS, throttler
│   │   ├── app.module.ts     wires every feature module + middleware
│   │   ├── seed.ts           pnpm seed → demo clinic + admin user
│   │   ├── common/           clinic-context middleware, env validator, throttler config, time utils, test helpers
│   │   ├── health/           GET /health (public)
│   │   ├── scripts/          fix-appointment-indexes.ts (legacy index migration)
│   │   └── modules/          feature modules (one folder each — see §6)
│   ├── test/                 e2e specs (currently scaffold only)
│   ├── package.json          pnpm scripts
│   └── .env.example          authoritative list of env vars
├── frontend/                 React 19 + Vite 8 + Tailwind 3 (port 5173)
├── docker-compose.yml        Mongo + Redis + MinIO (+ minio-init bucket bootstrap)
├── CLAUDE.md                 codebase conventions
├── README.md                 (Nest scaffold — to be replaced; see roadmap 0.8)
├── clinic-management-implementation-plan.md    original product spec
└── docs/
    ├── production-roadmap.md
    ├── backend-handoff.md                         (this file)
    └── superpowers/plans/                         per-workstream execution plans
```

There is **no root `package.json`**. Always `cd backend/` (or `cd frontend/`) — or run via `pnpm -C backend …`.

---

## 4. Local Development

### 4.1 Prerequisites
- Node 20+, pnpm, Docker (for Mongo / Redis / MinIO).

### 4.2 First-time setup

```bash
# from repo root
docker compose up -d            # starts mongo, redis, minio + creates bucket "digirx"

cd backend
cp .env.example .env            # then edit secrets if needed
pnpm install
pnpm seed                       # creates Demo Clinic, Main Branch, Admin role, admin user
                                # prints clinicId / branchId / login hint
pnpm start:dev                  # nest start --watch on :4000
```

In a separate terminal:

```bash
cd frontend
cp .env.example .env            # VITE_API_BASE_URL=http://localhost:4000
pnpm install
pnpm dev                        # Vite on :5173
```

### 4.3 Seed output (default credentials)

| Field | Value |
|---|---|
| Clinic | "Demo Clinic" — country `IN`, tz `Asia/Kolkata`, currency `INR` |
| Branch | "Main Branch" |
| Role | "Admin" — every Permission enum value |
| User | `admin@digirx.local` / `Admin@123` (override via `SEED_ADMIN_PASSWORD`) |

The seed script is **idempotent** — safe to rerun.

### 4.4 Common backend scripts

| Script | What it does |
|---|---|
| `pnpm start:dev` | Watch-mode dev server (port 4000) |
| `pnpm build` | `nest build` → `dist/` |
| `pnpm start:prod` | `node dist/main` |
| `pnpm seed` | Insert demo clinic + admin (idempotent) |
| `pnpm fix:indexes:appointments` | One-off: drop legacy `appt_queue_unique_idx` on databases that predate the partial-index change |
| `pnpm lint` | ESLint with `--fix` |
| `pnpm test` | Jest unit tests (`*.spec.ts` under `src/`) |
| `pnpm test -- path/to/file.spec.ts` | Run a single spec file |
| `pnpm test -- -t "name"` | Filter by test name |
| `pnpm test:e2e` | Jest e2e (`test/jest-e2e.json`) |
| `pnpm format` | Prettier |

---

## 5. Architecture

### 5.1 Module map

```
common/        clinic-context middleware, env validator, throttler, clinic-time helpers
health/        public liveness probe

modules/
├── auth          POST /auth/login, /auth/refresh, /auth/logout (cookie-bound refresh)
├── authz         GET /me, Permission enum, Role schema, PermissionsGuard, @Public/@RequirePermissions
├── tenancy       Clinic + Branch schemas, GET/PATCH /clinic/settings
├── access-logs   AccessLog schema + middleware, GET /access-logs (+ /export)
├── audit         AuditLog schema + global AuditInterceptor (POST/PATCH/PUT/DELETE)
├── patients      Patient + PatientIdentifier, search/normalization, history (stub)
├── availability  Doctor weekly rules + per-date overrides, slot computation
├── appointments  TIME + QUEUE booking, conflict prevention, check-in
├── encounters    DRAFT/SIGNED visit records, vitals, diagnosis
├── prescriptions Hybrid items (catalog + free-text), share token, PDF
├── billing       Bill, Payment (idempotent), ServiceCatalogItem, totals computation, PDF
├── documents     S3 presign upload/download, DocumentShare with expiry/maxViews
├── notifications NotificationTemplate + NotificationLog, BullMQ queue (optional), 5-min reminder cron
├── reports       Revenue, daily schedule, pending payments
├── pdf           Internal PdfService (pdf-lib)
└── storage       Internal StorageService (S3 / MinIO)
```

### 5.2 Request lifecycle

```
HTTP request
   │
   ├── ThrottlerGuard          (global 120/min; auth & /share/* tightened to 10/min)
   │
   ├── ClinicContextMiddleware (everywhere except /auth/**, /health, /share/**)
   │     • verifies "Authorization: Bearer <jwt>" with JWT_ACCESS_SECRET
   │     • parses clinicId, branchId, sub → req.context (already as ObjectIds)
   │     • dev fallback: x-clinic-id / x-branch-id / x-user-id
   │       only when NODE_ENV !== 'production' AND ALLOW_DEV_AUTH_HEADERS=true
   │
   ├── PermissionsGuard         (global APP_GUARD, default-deny)
   │     • @Public()                     → bypass
   │     • @RequirePermissions()         → auth required, no specific capability (used by /me)
   │     • @RequirePermissions(P, ...)   → AuthzService.getActor() must include all P
   │     • handler missing both decorators → 403
   │
   ├── ValidationPipe           (global; whitelist + forbidNonWhitelisted + transform)
   │
   ├── Controller → Service → Mongoose
   │
   ├── AuditInterceptor (global APP_INTERCEPTOR)
   │     • on success of POST/PATCH/PUT/DELETE: writes AuditLog (fire-and-forget)
   │     • entityType derived from route, entityId from req.params.id
   │     • GETs are NOT audited
   │
   └── res.on('finish'): AccessLogMiddleware writes AccessLog row
         (non-/health requests with a req.context only)
```

### 5.3 Multi-tenant rule (security-critical)

> **Every service method takes `clinicId: Types.ObjectId` as the first scoping parameter and includes it in every Mongoose query.** Cross-tenant leakage is the primary security concern and the failure mode each new endpoint must defend against.

`req.context.clinicId` is already an `ObjectId` by the time it reaches a controller — **do not re-parse it**.

### 5.4 Critical correctness paths

These three flows are well-tested and must not regress:

1. **Appointment booking** (`AppointmentsService.create` in `backend/src/modules/appointments/appointments.service.ts`)
   - **TIME**: validates against doctor's availability rules + overrides → opens a Mongo session and runs `$lt endAt && $gt startAt` overlap check inside a transaction, against `ACTIVE_TIME_STATUSES`. On standalone Mongo (no replica set) it gracefully falls back to a non-transactional check, detected by the error string `"Transaction numbers are only allowed"`. **Preserve this fallback** — dev runs a standalone Mongo.
   - **QUEUE**: atomic `findOneAndUpdate({upsert: true, $inc})` on `QueueCounter`, scoped by `(clinicId, branchId, doctorId, queueDate)`.
   - `queueDate` is a **`YYYY-MM-DD` string in clinic-local time**, not a UTC `Date`. The unique index `appt_queue_unique_idx` uses `partialFilterExpression: { type: QUEUE }` so TIME docs (with null queue fields) don't collide.

2. **Idempotent payments** (`BillingService.addPayment`)
   - `POST /bills/:id/payments` requires a client-generated `idempotencyKey` (8–64 chars; UUID v4 in the FE).
   - Partial unique index on `(clinicId, billId, idempotencyKey)` enforces dedupe.
   - A repeat POST with the same key on the same bill returns the original payment with header `X-Idempotent-Replay: true`.
   - Service returns `{ payment, replayed }`; controller maps `replayed → header`.

3. **Public share endpoints** (`/share/:token` and `/share/prescriptions/:token`)
   - Enforce `expiresAt`, `revokedAt`, and (for documents only) `maxViews`.
   - `maxViews` is enforced atomically via `findOneAndUpdate` + `$inc(viewCount)` + `$lt` guard.
   - Invalid / expired / revoked → 404 (no existence oracle). Doc-share view limit reached → 410.
   - Rate-limited to 10 req/min per IP.

### 5.5 Timezones (non-trivial)

- All timestamps are stored as UTC `Date`.
- Date-bounded queries (appointment lists, revenue ranges, reminder buckets, queue dates) are computed in the **clinic's stored timezone** via Luxon.
- Helper: `computeClinicDayRange(date, tz)` in `backend/src/common/`.
- `queueDate` is a clinic-local `YYYY-MM-DD` string; `startAt`/`endAt`/`visitedAt`/etc. are UTC `Date`s.

### 5.6 Clinic settings

Settings are stored as an opaque `Record<string, unknown>` on `Clinic.settings`. **Read them through `mergeClinicSettings(raw)`** in `backend/src/modules/tenancy/clinic-settings.types.ts` — it fills defaults and coerces invalid values. Any new setting must be added there so downstream code sees a typed shape.

### 5.7 Notifications wiring

`NotificationsModule.forRoot()` conditionally wires BullMQ + worker: only when `NOTIFICATIONS_QUEUE_ENABLED=true` AND `REDIS_URL` is set are `BullModule` and `NotificationsProcessor` registered. Without the queue, `NotificationsService.enqueueSend` still writes a `NotificationLog` row (status `Queued`) — so dev without Redis is safe; messages just accumulate as logs.

`NotificationsScheduler` runs `@Cron('*/5 * * * *')` and looks for appointments starting in each `REMINDER_WINDOWS_MINUTES` window (default `1440,120`) using a 5-minute bucket. Templates are per-clinic + per-channel; a fallback body is used if no template matches.

The current production provider implementation is `ConsoleNotificationProvider` only. **Real SMS/WhatsApp delivery is not implemented** — see roadmap 2.2.

---

## 6. API Catalog

> All non-public routes require `Bearer <jwt>` (or, in dev with `ALLOW_DEV_AUTH_HEADERS=true`, the `x-clinic-id` / `x-user-id` / `x-branch-id` headers). 401 on missing context; 403 on missing permission.

### 6.1 Public routes (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness probe → `{ ok: true }` |
| POST | `/auth/login` | Body: `{ clinicId, email, password, branchId? }` → `{ accessToken, userId, clinicId, branchId }` + sets `digirx_refresh` httpOnly cookie. **10 req/min.** |
| POST | `/auth/refresh` | Reads refresh cookie → new `accessToken`. **10 req/min.** |
| POST | `/auth/logout` | Clears refresh cookie. |
| GET | `/share/:token` | Public document download. Query `?inline=true` for inline. Honors expiry, revocation, maxViews. **10 req/min.** |
| GET | `/share/prescriptions/:token` | Public prescription read. Honors expiry, revocation. **10 req/min.** |

### 6.2 Authenticated routes (by module)

**`/me` (authz)** — `@RequirePermissions()` (auth-only, no capability)
- `GET /me` → `{ clinicId, branchId, user, roles[], permissions[] }`

**Tenancy** — `clinic:read` / `clinic:write`
- `GET /clinic/settings`
- `PATCH /clinic/settings`

**Access logs** — `clinic:read`
- `GET /access-logs?limit=50&before&path&method&statusCode`
- `GET /access-logs/export?limit=200&before`

**Patients** — `patient:read` / `patient:write` (and `document:write` for upload)
- `POST /patients`
- `GET /patients?query&limit=25&before`  (cursor pagination)
- `GET /patients/:id`
- `GET /patients/:id/history`  ⚠ **stub** — returns empty arrays
- `POST /patients/:id/documents` (multipart `file`)  ⚠ **competing path with `/documents/upload-url`**, see §10

**Availability** — `clinic:read` / `clinic:write`
- `GET /availability/doctors/:doctorUserId/day?date&branchId`
- `PUT /availability/doctors/:doctorUserId/rules?branchId`  body: `UpsertDoctorRulesDto`
- `PUT /availability/doctors/:doctorUserId/overrides/:date?branchId`  body: `UpsertDoctorOverrideDto`
- `PATCH /availability/doctors/:doctorUserId/overrides/:date/close?branchId`

**Appointments** — `appointment:read` / `appointment:write`
- `POST /appointments`
- `GET /appointments?branchId&date&doctorId?`
- `GET /appointments/slots?branchId&doctorId&date`
- `PATCH /appointments/:id`
- `POST /appointments/:id/checkin`
- `GET /doctors/availability?doctorId&from&to&branchId`  ⚠ **placeholder** (returns `{ available: true, slots: [] }`)

**Encounters** — `patient:read` / `patient:write`
- `POST /encounters`
- `GET /encounters/:id`
- `PATCH /encounters/:id`
- `POST /encounters/:id/sign`  ⚠ no `signedBy`/`signedAt`/immutability lock yet (roadmap 1.2)

**Prescriptions** — `patient:read` / `patient:write`
- `POST /encounters/:id/prescriptions`
- `GET /prescriptions/:id`
- `POST /prescriptions/:id/share`
- `POST /prescriptions/:id/share/revoke`
- `GET /prescriptions/:id/pdf` → presigned URL (`expiresInSeconds: 300`)

**Documents** — `document:read` / `document:write`
- `POST /documents/upload-url`  body: `CreateUploadUrlDto` → `{ documentId, storageKey, uploadUrl, expiresInSeconds }`
- `GET /documents/:id/download` → `{ url, expiresInSeconds: 300 }`
- `POST /documents/:id/share`  body: `{ expiresInSeconds?, maxViews? }`
- `POST /documents/:id/share/revoke`

**Billing** — `billing:read` / `billing:write`
- `POST /bills`
- `PATCH /bills/:id` (only on DRAFT)
- `POST /bills/:id/issue` (assigns `billNo`, becomes ISSUED)
- `GET /bills/:id`
- `POST /bills/:id/payments` (requires `idempotencyKey`)
- `GET /bills/:id/payments`
- `GET /bills/:id/pdf`
- `GET /catalog/services`, `POST /catalog/services`
- `GET /reports/revenue`  ⚠ **duplicate stub on this controller** — the real one is on ReportsController (roadmap 0.8)

**Reports** — `billing:read` (revenue, pending) / `appointment:read` (schedule)
- `GET /reports/revenue?from&to&branchId?`
- `GET /reports/schedule/daily?date&branchId`
- `GET /reports/pending-payments?branchId?&limit=50`

**Notifications** — `notification:read` / `notification:write`
- `POST /notifications/test`
- `GET /notifications/logs?limit=50` (max 200)
- `GET /notifications/templates`
- `POST /notifications/templates`

### 6.3 Background jobs

| Schedule | What it does |
|---|---|
| `*/5 * * * *` | `NotificationsScheduler` — sends reminder messages for appointments starting in each `REMINDER_WINDOWS_MINUTES` window (default 24h, 2h ahead). Templates keyed `appointment_reminder_{minutes}m`. |

### 6.4 Permission enum (`backend/src/modules/authz/permissions.ts`)

```
clinic:read       clinic:write
branch:read       branch:write       ← ⚠ unused (no admin endpoints yet — roadmap 0.7)
user:read         user:write         ← ⚠ unused (no admin endpoints yet — roadmap 0.7)
patient:read      patient:write
appointment:read  appointment:write
billing:read      billing:write
document:read     document:write
notification:read notification:write
```

---

## 7. Data Model

> 22 collections. Every collection has `clinicId` indexed and `timestamps: true`.

### 7.1 Identity & access

| Collection | Key fields | Notable indexes |
|---|---|---|
| `clinics` | `name`, `countryCode`, `timezone`, `currency`, `phoneCountryCode`, `settings` | `{ name }` |
| `branches` | `clinicId`, `name`, `address`, `workingHours`, `holidayCalendarId` | unique `{ clinicId, name }` |
| `users` | `clinicId`, `branchIds[]`, `defaultBranchId`, `email`, `phone`, `name`, `status`, `passwordHash`, `roleIds[]` | unique sparse `{ clinicId, email }` and `{ clinicId, phone }` |
| `roles` | `clinicId`, `name`, `permissions[]` | unique `{ clinicId, name }` |
| `sessions` | `clinicId`, `userId`, `refreshTokenHash`, `expiresAt`, `revokedAt` | TTL on `expiresAt` (auto-cleanup) |

### 7.2 Patient & clinical

| Collection | Key fields | Notable indexes |
|---|---|---|
| `patients` | `clinicId`, `primaryBranchId?`, `fullName`, `normalizedName`, `gender`, `dob?`, `phones[]`, `normalizedPhones[]`, `emails[]`, `address?`, `tags[]`, `notes?` | `{ clinicId, normalizedName }`, `{ clinicId, phones }`, `{ clinicId, normalizedPhones }` |
| `patientidentifiers` | `clinicId`, `patientId`, `type` (MRN \| EXTERNAL_ID), `value` | unique `{ clinicId, type, value }` |
| `doctorprofiles` | `clinicId`, `userId` (unique), `specialties[]`, `defaultSlotMinutes` (default 15) | unique `{ userId }` |
| `doctoravailabilityrules` | `clinicId`, `branchId`, `doctorUserId`, `weekday` (0–6), `windows[]` (`{startMinutes,endMinutes}`), `slotMinutes?`, `active` | unique `{ clinicId, branchId, doctorUserId, weekday }` |
| `doctoravailabilityoverrides` | `clinicId`, `branchId`, `doctorUserId`, `date` (`YYYY-MM-DD`), `type` (CLOSED \| CUSTOM_WINDOWS), `windows[]`, `note?` | unique `{ clinicId, branchId, doctorUserId, date }` |
| `appointments` | `clinicId`, `branchId`, `doctorId`, `patientId`, `type` (TIME \| QUEUE), `startAt?`, `endAt?`, `queueDate?`, `queueNumber?`, `status`, `source`, `notes?`, `createdBy?` | `{ clinicId, branchId, doctorId, startAt }`; **partial** unique on `{ clinicId, branchId, doctorId, type, queueDate, queueNumber }` filtered to `type='QUEUE'` |
| `queuecounters` | `clinicId`, `branchId`, `doctorId`, `queueDate`, `lastNumber` | unique `{ clinicId, branchId, doctorId, queueDate }` |
| `encounters` | `clinicId`, `branchId`, `doctorId`, `patientId`, `appointmentId?`, `visitedAt`, `chiefComplaint?`, `notes?`, `diagnosis?`, `vitals?`, `followUpAt?`, `status` (DRAFT \| SIGNED) | `{ clinicId, patientId, visitedAt: -1 }` |
| `prescriptions` | `clinicId`, `branchId`, `doctorId`, `patientId`, `encounterId`, `items[]`, `shareToken?`, `shareTokenExpiresAt?`, `shareTokenRevokedAt?`, `pdfDocumentId?` | `{ clinicId, patientId, createdAt:-1 }`, sparse `{ shareToken }` |

`Prescription.items[]` shape: `{ medicineCatalogItemId?, customName?, dosage?, frequency?, duration?, instructions? }` — hybrid catalog/free-text. There is **no** `MedicineCatalogItem` schema yet (roadmap 1.3).

### 7.3 Billing

| Collection | Key fields | Notable indexes |
|---|---|---|
| `bills` | `clinicId`, `branchId`, `patientId`, `encounterId?`, `appointmentId?`, `billNo?`, `currency`, `items[]`, `subtotal`, `discount`, `tax`, `total`, `status` (DRAFT \| ISSUED \| VOID), `issuedAt?`, `pdfDocumentId?`, `createdBy?` | `{ clinicId, branchId, createdAt:-1 }`; unique sparse `{ clinicId, branchId, billNo }` |
| `payments` | `clinicId`, `branchId`, `billId`, `method` (CASH \| UPI \| CARD \| ONLINE \| BANK_TRANSFER), `amount`, `providerRef?`, `paidAt`, `receivedBy?`, `idempotencyKey?` | `{ clinicId, billId, paidAt:-1 }`; **partial** unique on `{ clinicId, billId, idempotencyKey }` filtered to `idempotencyKey: { $type: 'string' }` |
| `servicecatalogitems` | `clinicId`, `name`, `defaultPrice`, `taxCode?`, `active` | unique `{ clinicId, name }` |

`Bill.items[]` shape: `{ serviceCatalogItemId?, customName?, quantity, unitPrice, amount }`. Totals are computed by `computeTotals` in `billing.utils.ts` — call it whenever items/discount/tax change.

### 7.4 Documents

| Collection | Key fields | Notable indexes |
|---|---|---|
| `documents` | `clinicId`, `ownerType` (PATIENT \| APPOINTMENT \| ENCOUNTER \| BILL \| PRESCRIPTION), `ownerId`, `mimeType`, `fileName`, `sizeBytes`, `storageKey`, `access` (INTERNAL_ONLY \| SHAREABLE_WITH_TOKEN), `createdBy?` | `{ clinicId, ownerType, ownerId, createdAt:-1 }` |
| `documentshares` | `clinicId`, `documentId`, `token` (unique), `expiresAt?`, `maxViews?`, `viewCount`, `revokedAt?`, `createdBy?` | unique `{ token }` |

### 7.5 Notifications, audit, access

| Collection | Key fields | Notable indexes |
|---|---|---|
| `notificationtemplates` | `clinicId`, `channel` (SMS \| WHATSAPP), `key`, `body`, `active` | unique `{ clinicId, channel, key }` |
| `notificationlogs` | `clinicId`, `branchId?`, `channel`, `to`, `body`, `dedupeKey?`, `status` (QUEUED \| SENT \| FAILED), `attempts`, `providerMessageId?`, `providerResponse?`, `lastError?` | `{ clinicId, createdAt:-1 }`; sparse unique `{ clinicId, dedupeKey }` |
| `auditlogs` | `clinicId`, `branchId?`, `actorUserId?`, `action` (CREATE \| UPDATE \| DELETE), `entityType`, `entityId`, `meta?` | `{ clinicId, createdAt:-1 }` |
| `accesslogs` | `clinicId`, `branchId?`, `actorUserId?`, `method`, `path`, `statusCode`, `durationMs`, `requestId?`, `userAgent?`, `ip?` | `{ clinicId, createdAt:-1 }`, `{ clinicId, path, createdAt:-1 }` |

---

## 8. Configuration

### 8.1 Backend `.env` (see `backend/.env.example`)

| Key | Purpose | Default / example |
|---|---|---|
| `PORT` | HTTP port | `4000` |
| `NODE_ENV` | Stage | `development` |
| `ALLOW_DEV_AUTH_HEADERS` | Enables the `x-clinic-id`/`x-user-id`/`x-branch-id` fallback. **Forbidden in production** (boot fails). | `true` (dev only) |
| `MONGODB_URI` | Mongo connection string. **Must not target localhost in production.** | `mongodb://root:rootpassword@localhost:27017/digirx?authSource=admin` |
| `REDIS_URL` | Redis connection (for BullMQ / cache) | `redis://localhost:6379` |
| `S3_ENDPOINT` | S3 endpoint (MinIO in dev) | `http://localhost:9000` |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_BUCKET` | Document bucket | `digirx` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | S3 creds | `minioadmin` / `minioadmin` |
| `S3_FORCE_PATH_STYLE` | **Required for MinIO** | `true` |
| `NOTIFICATIONS_QUEUE_ENABLED` | Wires BullMQ queue + worker | `false` (dev) |
| `REMINDER_WINDOWS_MINUTES` | Reminder offsets, comma-separated | `1440,120` |
| `FRONTEND_ORIGIN` / `CORS_ORIGINS` | CORS allowlist (comma-separated overrides single) | `http://localhost:5173` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Token signing. Default values **must be overridden in production** (boot fails). | `dev_*_change_me` |
| `JWT_ACCESS_TTL` | Access token TTL | `8h` |
| `JWT_REFRESH_DAYS` | Refresh token TTL | `30` |
| `SEED_ADMIN_PASSWORD` | Admin password used by `pnpm seed` | `Admin@123` |

### 8.2 Production env validation

`backend/src/common/config.ts` — `validateEnv()` runs at boot and **throws non-zero** if:
- `NODE_ENV=production` AND `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` still equal their `dev_*_change_me` defaults.
- `NODE_ENV=production` AND `MONGODB_URI` targets `localhost`.
- `NODE_ENV=production` AND `ALLOW_DEV_AUTH_HEADERS=true`.

### 8.3 Frontend `.env`

- `VITE_API_BASE_URL` — defaults to `http://localhost:4000`.

### 8.4 Docker compose services

| Service | Port | Notes |
|---|---|---|
| `mongodb` | 27017 | Mongo 7, root/rootpassword. **Standalone** in dev (transactions fall back); production must run a replica set (roadmap 3.1). |
| `redis` | 6379 | Redis 7 |
| `minio` | 9000 (API), 9001 (console) | minioadmin/minioadmin |
| `minio-init` | — | Idempotently creates the `digirx` bucket on startup |

---

## 9. Conventions

### 9.1 Schemas
- Use `@Schema({ timestamps: true })` on every collection.
- Always index `clinicId` (and `branchId` where applicable).
- Use Mongoose decorators from `@nestjs/mongoose`.

### 9.2 DTOs and validation
- DTOs live under `modules/<x>/dto/` with `class-validator` decorators.
- The global `ValidationPipe` (`whitelist: true, forbidNonWhitelisted: true, transform: true`) is enforced in `main.ts` — bad bodies are rejected with 400 before the handler runs.
- DTO specs live alongside as `*.dto.spec.ts` and assert at least one happy and one rejection case using the `expectInvalid` / `expectValid` helpers in `backend/src/common/test/dto-validator.ts`.
- `reflect-metadata` is loaded for every Jest test via `setupFiles` in `backend/package.json`.

### 9.3 Controllers
- Stay thin: extract `req.context!.clinicId` and delegate to services. **Never reach into Mongoose models from a controller.**

### 9.4 Tests
- Co-located `*.spec.ts` for unit tests under `src/`.
- E2E in `backend/test/` with `*.e2e-spec.ts` (currently scaffold only).

### 9.5 Linting
- ESLint flat config (`eslint.config.mjs`) with type-aware rules + Prettier plugin.
- Prettier: single quotes, trailing commas.
- `pnpm lint` must exit 0.

---

## 10. Implementation Status

The roadmap (`docs/production-roadmap.md`) defines four phases and the exit bar for each. The summary below is the snapshot to communicate to the receiving team.

### 10.1 What is implemented and stable

| Area | Status |
|---|---|
| Multi-tenant request context (JWT + dev fallback gated on `ALLOW_DEV_AUTH_HEADERS`) | ✅ |
| Default-deny `PermissionsGuard` with `@Public()` / `@RequirePermissions()` | ✅ |
| Global `ValidationPipe` + DTO decorators on every documented module | ✅ |
| Global `AuditInterceptor` + `AccessLogMiddleware` | ✅ |
| Tenant-scoped schemas (everything carries `clinicId`) | ✅ |
| Clinic-tz date-bounded queries (`computeClinicDayRange` used in appointments + reports) | ✅ |
| Appointment double-booking prevention (transactional + standalone fallback) | ✅ |
| Doctor availability (weekly rules + per-date overrides + slot computation in clinic TZ) | ✅ |
| Idempotent payments via `(clinicId, billId, idempotencyKey)` partial unique index | ✅ |
| Public share endpoints honor `expiresAt`, `revokedAt`, atomic `maxViews` | ✅ |
| Throttling: 120/min global, 10/min on `/auth/*` and `/share/*` | ✅ |
| Production env validation (non-default JWT secrets, non-localhost Mongo, dev-headers off) | ✅ |
| S3/MinIO presigned PUT/GET; `Document` + `DocumentShare` schemas | ✅ |
| PDF generation (bills + prescriptions) via `pdf-lib` | ✅ |
| Optional BullMQ notification queue + 5-min reminder cron | ✅ |
| JWT access + bcrypt-hashed rotating refresh token via httpOnly cookie | ✅ |

### 10.2 Phase 0 — Foundation hardening (≈ 2 weeks; partially done)

- ✅ **0.1** Auth + tenant-context lockdown (workstream merged)
- ✅ **0.2** Global DTO validation (workstream merged)
- ✅ **0.3** Clinic-timezone correctness (workstream merged)
- ✅ **0.4** Public share endpoints honor schema (workstream merged)
- ✅ **0.5** Idempotent payments (workstream merged)
- ⏳ **0.6** Safety-critical tests — **outstanding**. The current suite is 16 mostly-DTO unit specs + 1 hello-world e2e. Roadmap requires: appointment overlap and queue concurrency tests; availability slot tests; billing totals; permissions guard matrix; tenant-isolation e2e suite using `mongodb-memory-server` (replica-set mode for transactions). **CI must run `pnpm test` and `pnpm test:e2e` and gate merges.**
- ⏳ **0.7** Admin CRUD to activate unused permissions — **outstanding**. The four declared permissions `branch:*`, `user:*` are never enforced because the endpoints don't exist. Need `branch.controller`, `users.controller`, `roles.controller` + tenant-isolation tests.
- ⏳ **0.8** Cleanup — **outstanding**:
  - Duplicate `GET /reports/revenue` stub on `BillingController` (the real one is on `ReportsController`) → remove.
  - Two competing patient-document upload paths (`POST /patients/:id/documents` stores metadata only; `POST /documents/upload-url` uses S3) → pick one.
  - Empty `finally {}` blocks in `appointments.service.ts:134-135, 203-204` → remove.
  - Replace the Nest-scaffold `backend/README.md` with a real one.
  - `pnpm lint` must exit 0.

### 10.3 Phase 1 — Core workflows completion (≈ 3–4 weeks; not started)

| Workstream | Outstanding work |
|---|---|
| **1.1 Patients** | `PatientIdentifier` CRUD + clinic-config MRN format; `PATCH /patients/:id`; **real `GET /patients/:id/history`** (it's currently a stub returning empty arrays); de-dupe on create; phonetic search (Mongo text index). |
| **1.2 Encounters & doctor workflow** | Add `signedBy`, `signedAt`, `signedHash` (SHA-256) on encounter sign; reject `PATCH` on signed encounters with 409; full vitals model; multi-entry diagnosis (ICD-10); `followUpAt` / `followUpNotes`. |
| **1.3 Prescriptions: hybrid catalog + share/send** | New `medicines` module with `MedicineCatalogItem` (search, CRUD); `POST /prescriptions/:id/share` should optionally enqueue a notification (`sendVia: 'SMS'\|'WHATSAPP'`); PDF must resolve real names (currently shows ObjectIds). |
| **1.4 Appointments UX & state machine** | `POST /appointments/:id/cancel` with reason; enforce status transitions in service layer; calendar/queue UIs in FE; conflict UX (next-3-slots suggestion); doctor↔branch and patient↔clinic validation. |
| **1.5 Billing v2** | `BillCounter` collection; clinic-setting `billing.billNoFormat` (e.g. `{branchCode}/{fiscalYear}/{seq:06d}`); `billing.fiscalYearStartMonth`; multi-item bills in FE; `POST /bills/:id/void`; `CreditNote` for partial refunds; per-bill currency selector. |
| **1.6 Documents: unify and audit** | Single upload path (`POST /documents/upload-url`); soft-delete (`deletedAt`, `deletedBy`); per-document `AccessLog` entries on download/share. |
| **1.7 Real front-desk + doctor UIs** | Largest single chunk. Either rewrite the React app with router + calendar + form library + design system, or keep the current console as `/dev` and build a new production frontend. Includes Playwright golden-path E2E. |

### 10.4 Phase 2 — Operational hardening (≈ 3 weeks; not started)

- **2.1 Reports v2** — daily/weekly/monthly revenue charts; doctor utilization; new vs returning patients; CSV/PDF exports; all in clinic TZ.
- **2.2 Notifications real delivery** — Twilio (SMS) and Gupshup (WhatsApp) providers selectable via env; full template interpolation (`{{patientName}}`, `{{appointmentTime}}`, etc.); per-clinic quiet hours; admin template editor with preview; single-log detail endpoint.
- **2.3 Search & indexing** — Mongo text indexes; phonetic fallback (`namePhonetic`); debounced FE autocomplete.
- **2.4 Audit/access logs queryable** — `GET /audit-logs`, `GET /access-logs` with new permissions; TTL retention; PII redaction.
- **2.5 Backups & DR** — daily `mongodump` to S3; `migrate-mongo` adopted for all schema changes (and the legacy `fix-appointment-indexes.ts` script retired into a real migration); restore runbook with a tested RTO/RPO.
- **2.6 Observability** — structured JSON logging (pino or NestJS Logger); deepened `/health` (Mongo + Redis + S3 `HeadBucket`); Prometheus `/metrics`; alerts/dashboards.

### 10.5 Phase 3 — Production readiness (≈ 2 weeks; not started)

- **3.1 Infrastructure** — Mongo replica set (so the standalone-Mongo TX fallback in `appointments.service.ts` becomes dead code, kept for local dev only); HA Redis; S3 SSE; TLS + HSTS + secure refresh cookies; secrets in a manager; dev/staging/prod separation.
- **3.2 CI/CD** — GitHub Actions (lint → typecheck → unit → e2e → FE build → Playwright); branch protection on `main`; staging-on-merge, prod-on-tag; pinned image tags.
- **3.3 Security review** — `pnpm audit` clean; pen test on staging; OWASP Top 10 checklist; PHI inventory.
- **3.4 Load & chaos** — 200-concurrent-booking test; 24h soak; Mongo primary kill drill.
- **3.5 Runbooks & on-call** — deploy/rollback/restart/drain/key-rotation runbook; incident template; alert routing; DSR playbook.

### 10.6 Phase 4 — Optional modules (defer)

- **4.1 Inventory / pharmacy** — `InventoryItem`, `InventoryBatch` (with expiry), `StockMovement`, low-stock alerts, deduct-on-bill. Behind `modules.inventory.enabled` flag (already in `ClinicSettingsV1`).
- **4.2 Patient portal** — separate FE app + public OTP auth + self-booking + record access. Distinct security model — requires its own risk review.
- **4.3 Analytics / BI** — nightly aggregation to a warehouse + Metabase-class dashboards.

### 10.7 Known limitations & technical debt

- Legacy `appt_queue_unique_idx` cleanup — pre-partial DBs need `pnpm fix:indexes:appointments` once. Replace with a real `migrate-mongo` migration in 2.5.
- Empty `finally {}` blocks in `appointments.service.ts` (cosmetic; roadmap 0.8).
- `GET /doctors/availability` returns a hardcoded `{ available: true, slots: [] }` placeholder — the real one is `/availability/doctors/:doctorUserId/day`.
- Notification provider implementation is `ConsoleNotificationProvider` only — nothing actually leaves the system in any environment.
- Dev-mode Mongo is standalone; the booking-overlap transaction silently falls back to non-transactional. Single-process dev usage is fine; in production this is unsafe and roadmap 3.1 mandates a replica set.
- Frontend is a developer console (manual ObjectId entry, JSON dumps), not a clinic-facing UI. Roadmap 1.7 is the rewrite.

---

## 11. Suggested onboarding path for the receiving developer

1. **Read in this order:** this document → `clinic-management-implementation-plan.md` (product spec) → `CLAUDE.md` (codebase conventions) → `docs/production-roadmap.md` (forward plan).
2. **Run it locally:** `docker compose up -d`; `cd backend && pnpm install && pnpm seed && pnpm start:dev`; `cd frontend && pnpm install && pnpm dev`. Log in with `admin@digirx.local` / `Admin@123`.
3. **Trace the booking path end-to-end** in `appointments.service.ts` — this is the most subtle code in the repo and the best calibration of the codebase's correctness style.
4. **Trace the payment idempotency path** — short, but representative of how mutations are written: DTO validation → service-layer business rule → atomic Mongo write → audit.
5. **Pick up roadmap 0.6 first** — adding the safety-critical test suite is both the highest-leverage gap and the best way to deeply learn the schemas. Workstreams 0.7 and 0.8 follow naturally.

---

## 12. References

- Product spec: `clinic-management-implementation-plan.md`
- Forward plan: `docs/production-roadmap.md`
- Per-workstream execution plans: `docs/superpowers/plans/YYYY-MM-DD-<workstream>.md`
- Codebase conventions: `CLAUDE.md`
- Env template: `backend/.env.example`
- Compose: `docker-compose.yml`
