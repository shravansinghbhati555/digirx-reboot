# DigiRx — Production Roadmap

> **For agentic workers:** This is a roadmap, not a single executable plan. Each **workstream** below is intended to be turned into its own concrete implementation plan (via `superpowers:writing-plans`) at the time it's picked up, then executed via `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Checkbox items here are **acceptance criteria for the workstream**, not TDD steps.

**Goal:** Take the current ~Phase-0.8 codebase to a production-grade, multi-tenant clinic management platform that can be safely operated for real clinics handling real PHI.

**Architecture:** Keep the modular monolith (NestJS + MongoDB + BullMQ + S3) and the split repo (`backend/`, `frontend/`). No framework swaps. Close the security/correctness/ops gaps first, then finish core workflows, then harden for operations, then ship.

**Tech Stack:** NestJS 11, Mongoose 9 / MongoDB 7 (replica set in prod), Redis 7 + BullMQ 5, S3-compatible storage (MinIO in dev), pdf-lib, Luxon, React 19 + Vite 8 + Tailwind 3, pnpm.

---

## 0. How to use this document

- This supersedes `clinic-management-implementation-plan.md` as the forward plan. The original plan is still the source of truth for **product requirements** (entities, roles, workflows) — refer to it when a workstream description is sparse.
- Each phase has an **exit bar**: don't start the next phase until the exit bar is met. The point of a phased plan is to avoid piling new features on a broken foundation.
- Each workstream references **concrete files** already in the repo. Where a file doesn't exist yet, the path reflects the established module convention (`backend/src/modules/<name>/...`).
- When starting a workstream, write its execution plan under `docs/superpowers/plans/YYYY-MM-DD-<workstream>.md`.

## 1. Current state (April 2026 snapshot)

What works:
- Multi-tenant request context, global `PermissionsGuard`, global `AuditInterceptor`, tenant-scoped schemas, audit + access-log collections.
- Appointment double-booking prevention: transactional overlap check with clean standalone-Mongo fallback (`backend/src/modules/appointments/appointments.service.ts`).
- Doctor availability math with Luxon timezone handling (`backend/src/modules/availability/availability.service.ts`).
- S3/MinIO presigned PUT/GET, `Document` + `DocumentShare` schemas, PDF generation for bills and prescriptions.
- BullMQ notification queue with conditional wiring, reminder scheduler at 5-min cadence.
- Auth: JWT access + bcrypt-hashed rotating refresh token via httpOnly cookie.

What is broken, stubbed, or missing (the material for this roadmap):
- `ClinicContextMiddleware` accepts unsigned `x-clinic-id` / `x-user-id` headers in every environment — tenant bypass.
- No global `ValidationPipe`; `class-validator` decorators are unenforced on most routes.
- No idempotency on `POST /bills/:id/payments`.
- Public `GET /share/:token` (documents + prescriptions) does not enforce `expiresAt` / `revokedAt` / `maxViews` and has no rate limit.
- Four declared permissions (`branch:*`, `user:*`) are never enforced because no admin CRUD endpoints exist.
- Appointment list and revenue reports bucket by UTC day, not clinic timezone (explicit placeholder comments).
- Patient history endpoint is a hardcoded stub.
- Encounter sign flow has no `signedBy` / `signedAt` / immutable lock.
- Billing: single-sequence `billNo`, no fiscal-year reset, no voids/refunds, no idempotent payments.
- Notification templates don't interpolate; only `ConsoleNotificationProvider` exists (no real SMS/WhatsApp).
- Two competing patient-document upload paths (`POST /patients/:id/documents` stores metadata only; `POST /documents/upload-url` uses S3).
- Duplicate `GET /reports/revenue` stub on `BillingController`.
- Empty `finally {}` blocks in `appointments.service.ts` (leftover scaffolding).
- Legacy `appt_queue_unique_idx` cleanup script (`pnpm fix:indexes:appointments`) needs to be run on pre-partial databases.
- Test suite is the default Nest scaffold only — zero meaningful tests for safety-critical paths.
- Frontend is a dev console (tab-switch, manual ObjectId entry, JSON dumps), not a front-desk/doctor UI.

## 2. Working principles

- **TDD for every safety-critical path** — overlap, totals, permissions, tenant isolation, idempotency. These are the tests called out in the original plan's minimum set.
- **Frequent commits per task** — no 30-file PRs.
- **One workstream, one PR, one merge** — so the merge queue stays interpretable and hotfixes are easy.
- **Don't break what works** — the appointment transaction path and availability math are working; no refactor-for-refactor's-sake.
- **Security defaults beat security toggles** — prefer default-deny (e.g., permission guard) over opt-in guards that can be forgotten.
- **Every change that touches PHI needs a test that asserts tenant isolation.**
- **Never merge with failing CI or skipped tests.**

---

## Phase 0 — Foundation hardening

**Length:** ~2 weeks of focused work.

**Exit bar:** The system cannot be trivially bypassed, defaults cannot deploy to production, and the critical path (appointment booking, payment, document share) has real tests.

### 0.1 Lock down the auth / tenant-context surface

**Files:**
- Modify: `backend/src/common/clinic-context.middleware.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/src/modules/authz/permissions.guard.ts`
- Create: `backend/src/common/config.ts` (fail-fast env validation)
- Create: `backend/src/common/throttler.module.ts` (wrap `@nestjs/throttler`)

Acceptance criteria:
- [ ] `x-clinic-id` / `x-user-id` header fallback is **only** active when `NODE_ENV !== 'production'` AND an explicit `ALLOW_DEV_AUTH_HEADERS=true` env is set. In every other case, missing Bearer → 401.
- [ ] `main.ts` throws and exits non-zero at boot if `NODE_ENV=production` and any of `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` still equal their `dev_*_change_me` defaults, or if `MONGODB_URI` still targets `localhost`.
- [ ] `PermissionsGuard` is **default-deny** for all non-auth, non-health routes: a handler without `@RequirePermissions(...)` or without an explicit `@Public()` decorator returns 403.
- [ ] `@Public()` decorator created and applied to `/auth/login`, `/auth/refresh`, `/auth/logout`, `/health`, `GET /share/:token`, `GET /share/prescriptions/:token`.
- [ ] `@nestjs/throttler` registered globally (120 req/min default); tighter override (10/min per IP) on `/auth/login`, `/share/*`.
- [ ] Tests: a request with a forged `x-clinic-id` header (no Bearer) receives 401 when `NODE_ENV=production`; a handler missing `@RequirePermissions` and `@Public` returns 403.

### 0.2 Enforce DTO validation globally

**Files:**
- Modify: `backend/src/main.ts`
- Audit every DTO under `backend/src/modules/*/dto/` for missing `class-validator` decorators

Acceptance criteria:
- [ ] `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))` added in `main.ts`.
- [ ] Every DTO has `@IsString()` / `@IsNumber()` / `@IsDateString()` / `@IsEnum()` / `@IsMongoId()` on all fields. No `any`.
- [ ] Body-posting 400 tests exist for at least one DTO per module, asserting that a bad field returns 400 with a helpful message.
- [ ] `PATCH /clinic/settings` and any other controller that currently calls `ValidationPipe` explicitly has the local usage removed (it's now global).

### 0.3 Clinic-timezone correctness

**Files:**
- Modify: `backend/src/modules/appointments/appointments.service.ts:210-229` (`listByDate`)
- Modify: `backend/src/modules/reports/reports.service.ts` (revenue range)
- Modify: `backend/src/modules/notifications/notifications.scheduler.ts` (reminder window bucketing — verify it already uses absolute instants, which is correct)
- Remove: empty `finally {}` blocks in `appointments.service.ts:134-135, 203-204`

Acceptance criteria:
- [ ] `listByDate` converts the incoming `YYYY-MM-DD` date into a UTC range using the clinic's stored timezone via Luxon (pattern already present in `availability.service.ts:141-148`).
- [ ] Revenue/report endpoints accept `from`/`to` as `YYYY-MM-DD` and compute bounds in clinic TZ.
- [ ] Test: with clinic TZ `Asia/Kolkata`, an appointment at `2026-05-01T19:30:00Z` (1:00 AM next day local) appears in the `2026-05-02` list, not `2026-05-01`.
- [ ] Empty `finally {}` blocks removed; session `endSession()` moved into the existing `finally`.

### 0.4 Public share endpoints: honor their own schema

**Files:**
- Modify: `backend/src/modules/documents/documents.service.ts` (`shareDownload`)
- Modify: `backend/src/modules/prescriptions/prescriptions.service.ts` (`getByShareToken`)
- Modify: `backend/src/modules/documents/documents.controller.ts`
- Modify: `backend/src/modules/prescriptions/prescriptions.controller.ts`
- Create: `backend/src/modules/documents/document-share.service.ts` (extract if inline)

Acceptance criteria:
- [ ] `shareDownload(token)` returns 404 if `revokedAt != null` OR `expiresAt < now`.
- [ ] `maxViews` on `DocumentShare` is incremented atomically per access (`$inc: { viewCount: 1 }` with `$lt` guard on `maxViews` if set); exceeded views return 410 Gone.
- [ ] Prescription share tokens have an `expiresAt` persisted on `Prescription` (add a `shareTokenExpiresAt` field) and are rejected after expiry.
- [ ] `POST /documents/:id/share/revoke` (requires `document:write`) endpoint exists and sets `revokedAt`.
- [ ] Throttler on `GET /share/:token` and `GET /share/prescriptions/:token` is tightened (10 req/min per IP).
- [ ] Tests: expired token → 404; revoked token → 404; maxViews exceeded → 410; signed URL returned is presigned and expires in ≤ 300s.

### 0.5 Idempotent payments

**Files:**
- Modify: `backend/src/modules/billing/dto/create-payment.dto.ts` (add `idempotencyKey: string`, required)
- Modify: `backend/src/modules/billing/schemas/payment.schema.ts` (add `idempotencyKey`, partial unique index on `(clinicId, billId, idempotencyKey)`)
- Modify: `backend/src/modules/billing/billing.service.ts:92-114`

Acceptance criteria:
- [ ] `POST /bills/:id/payments` requires `idempotencyKey` (min length 8, client-generated UUID acceptable).
- [ ] Partial unique index prevents duplicate insertion; duplicate POST returns the **original** `Payment` (200), not 409, with header `X-Idempotent-Replay: true`.
- [ ] Tests: two concurrent POSTs with the same key yield a single row and two identical responses; different keys create two rows.
- [ ] Frontend billing screen generates a UUID v4 per "Add payment" click and reuses it across retries.

### 0.6 Safety-critical tests

**Files:**
- Create: `backend/src/modules/appointments/appointments.service.spec.ts`
- Create: `backend/src/modules/availability/availability.service.spec.ts`
- Create: `backend/src/modules/billing/billing.service.spec.ts`
- Create: `backend/src/modules/billing/billing.utils.spec.ts`
- Create: `backend/src/modules/authz/permissions.guard.spec.ts`
- Create: `backend/test/tenant-isolation.e2e-spec.ts`
- Create: `backend/test/jest-e2e.json` already exists — ensure CI runs it.
- Create: `backend/test/setup.ts` (spin up an in-memory Mongo via `mongodb-memory-server` replica-set mode so transactions work)

Acceptance criteria:
- [ ] **Overlap tests**: two `TIME` appointments with overlapping ranges → second one gets 409; back-to-back (start = previous end) → both succeed.
- [ ] **Queue tests**: 50 concurrent QUEUE POSTs get queue numbers 1..50 with no gaps or duplicates.
- [ ] **Availability tests**: slot generation respects `CLOSED` override; `CUSTOM_WINDOWS` override replaces the weekly rule; clinic TZ boundary (slot ending at midnight local) computes correctly.
- [ ] **Billing totals**: `computeTotals` with fractional discounts/taxes rounds consistently; negative totals are rejected.
- [ ] **Permissions**: handler without `@RequirePermissions` returns 403; handler with unmet permission returns 403; correct permission returns 200.
- [ ] **Tenant isolation (e2e)**: User A in Clinic 1 cannot `GET /patients/:id`, `GET /bills/:id`, `GET /appointments/:id`, `GET /documents/:id` of Clinic 2 — all return 404 (not 403, to avoid existence oracle).
- [ ] CI runs `pnpm test` and `pnpm test:e2e` on every PR and fails the build on failure.

### 0.7 Admin CRUD to activate unused permissions

**Files:**
- Create: `backend/src/modules/tenancy/branch.controller.ts` + DTOs
- Create: `backend/src/modules/tenancy/branch.service.ts`
- Create: `backend/src/modules/authz/users.controller.ts` + DTOs
- Create: `backend/src/modules/authz/users.service.ts`
- Create: `backend/src/modules/authz/roles.controller.ts` + DTOs
- Modify: `backend/src/modules/authz/authz.module.ts`

Acceptance criteria:
- [ ] `POST/GET/PATCH /branches` with `@RequirePermissions(Permission.BranchWrite/BranchRead)`.
- [ ] `POST/GET/PATCH /users` and `POST /users/:id/password-reset` with `@RequirePermissions(Permission.UserWrite/UserRead)`. Password is bcrypt-hashed with cost 12.
- [ ] `POST/GET/PATCH /roles` with `@RequirePermissions(Permission.UserWrite)` and a validator that every value of `permissions[]` is a known `Permission`.
- [ ] Tenant isolation tests cover all three resources.

### 0.8 Cleanup (small but load-bearing)

**Files:**
- Remove: `backend/src/modules/billing/billing.controller.ts` duplicate revenue stub (keep the real one on `ReportsController`).
- Remove: `backend/src/modules/patients/patientDocuments.controller.ts` OR keep it and delete `/documents/upload-url` — pick one upload path for patients.
- Modify: `backend/src/modules/notifications/providers/` — document the `NotificationProvider` interface.
- Create: `backend/README.md` (replace the Nest starter boilerplate) and `frontend/README.md`.

Acceptance criteria:
- [ ] Only one way to upload a patient document. It uses S3 presigned PUT and persists bytes.
- [ ] `GET /reports/revenue` resolves to the real implementation (no `NOT_IMPLEMENTED` stub anywhere).
- [ ] `pnpm lint` in `backend/` exits 0.
- [ ] `backend/README.md` describes the actual app, not NestJS.

---

## Phase 1 — Core workflows completion

**Length:** ~3–4 weeks.

**Exit bar:** A front-desk user and a doctor can complete a patient's journey end-to-end — register → book → check in → consult → prescribe → bill → pay → document → reminders — without dropping into the dev console.

### 1.1 Patient domain completion

Acceptance criteria:
- [ ] `PatientIdentifier` CRUD endpoints (`POST /patients/:id/identifiers`, `DELETE`), MRN generation config-driven (clinic setting `patients.mrnFormat`).
- [ ] `PATCH /patients/:id` (name, gender, DOB, phones, emails, address, tags, notes).
- [ ] `GET /patients/:id/history` returns a real time-sorted merge of appointments, encounters, bills (with Mongo aggregation, paginated).
- [ ] De-dupe on create: exact phone match + similar normalized name returns 200 with `{ existing: [...] }` and `duplicateCandidate: true`; client decides whether to force-create via `?force=true`.
- [ ] Phonetic search (Mongo text index on `normalizedName` + `phones`).

### 1.2 Encounter signing and doctor workflow

Acceptance criteria:
- [ ] `Encounter` schema gains `signedBy: ObjectId`, `signedAt: Date`, `signedHash: string` (SHA-256 of content at sign time).
- [ ] `POST /encounters/:id/sign` records all three and rejects further `PATCH` with 409.
- [ ] Full vitals model: `{ heightCm?, weightKg?, temperatureC?, pulseBpm?, bpSystolic?, bpDiastolic?, spo2?, respiratoryRate? }` validated in DTO.
- [ ] `diagnosis` supports multiple entries `[{ code?: string (ICD-10), description: string, primary: boolean }]`.
- [ ] `followUpAt` + `followUpNotes`.
- [ ] Tests: signed encounter rejects PATCH; signedHash is reproducible from the encounter content at sign time.

### 1.3 Prescriptions: hybrid catalog + share/send

**Files (new module):** `backend/src/modules/medicines/` with `MedicineCatalogItem` schema (name, forms[], strengths[], genericName, composition, active).

Acceptance criteria:
- [ ] `MedicineCatalogItem` CRUD, clinic-scoped, with search endpoint (text index on name + genericName).
- [ ] `Prescription.items[]` supports multiple items in one prescription (frontend + backend).
- [ ] `POST /prescriptions/:id/share` returns a **tokenized URL**, stores `expiresAt` (default 7d, configurable per clinic setting), and optionally **sends it via SMS/WhatsApp** when `sendVia: 'SMS'|'WHATSAPP'` is passed — enqueues a `NotificationLog` using the existing `NotificationsService`.
- [ ] PDF resolves **real** clinic name, patient name, doctor name (not hex ObjectIds) — pass resolved entities into `PdfService`.
- [ ] Tests: share + send enqueues a notification; expired share is 404.

### 1.4 Appointments: real UX + workflow states

Acceptance criteria:
- [ ] `POST /appointments/:id/cancel` (with cancellation reason) — state transitions `BOOKED|CHECKED_IN → CANCELLED` only.
- [ ] Status workflow enforced at the service layer: `BOOKED → CHECKED_IN → IN_PROGRESS → DONE` (no skipping); reverse transitions only allowed to `CANCELLED` or `NO_SHOW`.
- [ ] Frontend calendar view for TIME appointments (day + week) + queue board for QUEUE (ordered by `queueNumber`).
- [ ] Check-in button on the list row; transition state visible.
- [ ] Conflict UX: on 409, the frontend highlights the specific conflicting slot and suggests the next three available slots.
- [ ] Validation: doctor must have `UserBranchAccess` for `branchId`; patient must belong to same clinic.

### 1.5 Billing: multi-item, fiscal sequencing, voids

**Files:**
- Modify: `backend/src/modules/billing/billing.service.ts`
- Create: `backend/src/modules/billing/schemas/bill-counter.schema.ts`
- Create: `backend/src/modules/billing/bill-numbering.service.ts`

Acceptance criteria:
- [ ] `BillCounter` collection with `(clinicId, branchId, fiscalYear)` unique key; `issueBill` does an atomic `findOneAndUpdate` `$inc` (same pattern as `QueueCounter`).
- [ ] Bill number format is clinic-setting-driven: `billing.billNoFormat = "{branchCode}/{fiscalYear}/{seq:06d}"`.
- [ ] Fiscal year boundary configurable (`billing.fiscalYearStartMonth`, default 4 for India).
- [ ] Multi-item bills on the frontend (add/remove/edit line items on DRAFT).
- [ ] `POST /bills/:id/void` (requires `billing:write`) + void reason; issued bills can be voided only (never edited).
- [ ] `POST /bills/:id/credit-notes` for partial refunds (new `CreditNote` schema linking to `Bill`).
- [ ] `currency` selectable per bill (defaulting from `Clinic.currency`, frontend stops hardcoding INR).
- [ ] Tests: 100 concurrent `issueBill` calls produce sequential numbers with no gaps/duplicates; void is idempotent.

### 1.6 Documents: unify and audit

Acceptance criteria:
- [ ] One upload path: `POST /documents/upload-url` (presigned PUT). Legacy `POST /patients/:id/documents` deleted or aliased.
- [ ] `Document` soft-delete: `deletedAt`, `deletedBy`; `GET /documents/:id/download` returns 404 for deleted docs.
- [ ] Every `GET /documents/:id/download` and `GET /share/:token` writes an `AccessLog` entry tagged with the document ID (beyond the generic request log).
- [ ] Frontend: document list per patient with filename, size, uploader, uploaded-at; download and revoke-share.

### 1.7 Real front-desk & doctor UIs

This is the largest single chunk. Either:
- **(A) Rewrite** the current React app with `react-router-dom`, a calendar library (e.g., `@tanstack/react-query` + `react-big-calendar` or FullCalendar), a form library (`react-hook-form` + `zod`), and a real design system; or
- **(B) Keep** the existing app as a "developer console" under `/dev` and build a new `frontend-app/` package for the production UI.

Acceptance criteria (either path):
- [ ] Real login page with forgot-password; no hardcoded creds.
- [ ] Router-based navigation with deep links: `/patients/:id`, `/appointments?date=...`, `/bills/:id`.
- [ ] Role-aware UI: nav items and action buttons hidden based on `/me.permissions`.
- [ ] Patient detail page (profile, identifiers, history tabs, documents, bills).
- [ ] Doctor console: today's appointments, active encounter editor with vitals/diagnosis/prescriptions/sign, history lookup.
- [ ] Front-desk console: patient search, book/cancel/check-in, queue board, add bill, add payment.
- [ ] Logout button wired to `POST /auth/logout`.
- [ ] Form validation via schema (`zod`) matching backend DTOs.
- [ ] E2E smoke test (Playwright) for the golden path: login → register patient → book → check-in → start encounter → sign → issue bill → add payment.

---

## Phase 2 — Operational hardening

**Length:** ~3 weeks.

**Exit bar:** Operations can diagnose, export, and recover. A real clinic using the system has visibility into what happened and can fix mistakes.

### 2.1 Reports (v2)

Acceptance criteria:
- [ ] Revenue by day/week/month, with charting on the frontend (`recharts` or similar).
- [ ] Doctor-wise utilization: booked slots vs available slots, by date range.
- [ ] Patient counts: new vs returning.
- [ ] Pending payments: paginated, sortable, with "send reminder" action.
- [ ] CSV export on every report; PDF export on revenue + daily schedule.
- [ ] All date ranges compute in clinic timezone.

### 2.2 Notifications — real delivery

**Files (new):** `backend/src/modules/notifications/providers/twilio.provider.ts`, `gupshup.provider.ts` (WhatsApp), selectable via env.

Acceptance criteria:
- [ ] `NOTIFICATIONS_SMS_PROVIDER` / `NOTIFICATIONS_WA_PROVIDER` env vars select the provider; `ConsoleNotificationProvider` remains the default in dev.
- [ ] Template interpolation wired end-to-end: `{{patientName}}`, `{{appointmentTime}}`, `{{clinicName}}`, `{{doctorName}}`, `{{branchAddress}}` all resolve against real entities in the scheduler.
- [ ] `dedupeKey` is enforced by the unique partial index on `NotificationLog` (already in schema) — the scheduler's best-effort try/catch becomes a real guarantee.
- [ ] Per-clinic delivery windows / quiet hours (clinic setting `notifications.quietHours = { start: "21:00", end: "08:00", tz: "..." }`); messages scheduled into quiet hours are deferred.
- [ ] Provider failure writes `lastError`, bumps `attempts`, BullMQ retries with exponential backoff (already wired — verify).
- [ ] Admin UI: template editor with live preview against a sample patient/appointment.
- [ ] `GET /notifications/logs/:id` (single log detail for support).

### 2.3 Search & indexing

Acceptance criteria:
- [ ] Mongo text indexes on `Patient.normalizedName`, `Patient.phones`, `MedicineCatalogItem.name`, `ServiceCatalogItem.name`.
- [ ] Phonetic (metaphone or soundex) fallback stored as `namePhonetic` on patient; search ranks exact > phonetic.
- [ ] Debounced autocomplete on the frontend patient search with cancellable requests.

### 2.4 Access logs / audit logs — queryable

Acceptance criteria:
- [ ] `GET /audit-logs` (requires a new `Permission.AuditRead`): filter by `entityType`, `entityId`, `actorUserId`, date range. Paginated.
- [ ] `GET /access-logs` same shape (require `Permission.AccessLogRead`).
- [ ] Retention: TTL indexes set per clinic setting (`logs.retentionDays`, default 365).
- [ ] Redact PII from logged request bodies (phone, email) — centralized redactor.

### 2.5 Backups & DR

Acceptance criteria:
- [ ] Daily `mongodump` to S3 via a cron BullMQ job; retention 30 days hot + 12 months cold (S3 Glacier class).
- [ ] Runbook: `docs/ops/restore.md` describing exact steps to restore from backup to a fresh instance — **tested once**, recovery time + point objective documented.
- [ ] `migrate-mongo` installed and used for all subsequent schema changes; `backend/migrations/` directory with one initial migration capturing current indexes (including the partial `appt_queue_unique_idx` migration that `fix-appointment-indexes.ts` performs — then delete the script).

### 2.6 Observability

Acceptance criteria:
- [ ] `nestjs-pino` or `@nestjs/common Logger` wired globally; structured JSON logs.
- [ ] Fire-and-forget audit/access-log write failures log a warning (currently silently swallowed).
- [ ] `/health` deepens: checks Mongo ping, Redis ping, S3 `HeadBucket`; 503 if any critical dep down.
- [ ] Prometheus metrics endpoint (`/metrics`) with HTTP latency histogram, BullMQ queue depth, DB query time.
- [ ] Dashboards + alerts (Grafana or provider-native): error rate > 1% for 5 min, p95 > 1s for 10 min, BullMQ queue depth > 1000.

---

## Phase 3 — Production readiness

**Length:** ~2 weeks.

**Exit bar:** You can deploy to a paying clinic without holding your breath.

### 3.1 Infrastructure

Acceptance criteria:
- [ ] MongoDB runs as a **replica set** in every non-local environment (so the TX fallback in `appointments.service.ts` is dead code — it can stay for local dev).
- [ ] Redis runs in sentinel or managed-HA mode.
- [ ] S3 bucket has SSE-S3 (or SSE-KMS) server-side encryption enabled; bucket policy denies unencrypted PUT.
- [ ] TLS terminated at the ingress; HSTS header; `secure: true` on refresh cookies in production.
- [ ] Secrets in a manager (AWS Secrets Manager / Vault), **not** env files on disk.
- [ ] Separate envs: `dev`, `staging`, `prod`. Staging mirrors prod infra shape.

### 3.2 CI/CD

Acceptance criteria:
- [ ] GitHub Actions (or equivalent) runs on every PR: install → lint → type-check → `pnpm test` (backend) → `pnpm test:e2e` (backend) → frontend build → Playwright smoke.
- [ ] Branch protection on `main`: PR required, CI green required, 1 approval required, no force push.
- [ ] Deploy pipeline: staging deploys on merge to `main`; prod deploys via manual approval on tagged release.
- [ ] Docker images built per commit with SHA tag; prod uses pinned tags.

### 3.3 Security review

Acceptance criteria:
- [ ] Dependency audit: `pnpm audit` clean or documented exceptions.
- [ ] Third-party pen test or internal red-team against the deployed staging (focus: tenant isolation, share-token abuse, payment idempotency, auth replay).
- [ ] OWASP Top 10 checklist done and attached to `docs/security/review-YYYY-MM-DD.md`.
- [ ] PHI inventory: every field that could be PHI catalogued; export/deletion paths documented.

### 3.4 Load & chaos

Acceptance criteria:
- [ ] Load test booking under concurrency: 200 concurrent bookings into overlapping slots, assert exactly the expected number succeed and the rest 409.
- [ ] Soak test: 24h at baseline traffic — no memory leak, no queue growth.
- [ ] Chaos test: kill Mongo primary during a booking — replica set elects, request either succeeds or fails cleanly (no partial state).

### 3.5 Runbooks & on-call

Acceptance criteria:
- [ ] `docs/ops/runbook.md`: deploy, rollback, restart workers, drain BullMQ, rotate JWT secrets.
- [ ] `docs/ops/incidents/` template + at least one dry-run incident.
- [ ] Alert routing: who gets paged for what (clinician-impacting vs ops).
- [ ] Data subject request (DSR) playbook: export all data for a patient / clinic; delete on request.

---

## Phase 4 — Optional modules (defer until Phase 3 is stable)

### 4.1 Inventory / in-house pharmacy

Scope: `InventoryItem`, `InventoryBatch` (with `expiryAt`), `StockMovement`, low-stock alerts, deduct on bill line items mapped to inventory items. Behind `modules.inventory.enabled` flag (already in `ClinicSettingsV1`).

### 4.2 Patient portal

Scope: separate frontend app, public auth (OTP), patient self-booking, prescription/bill download, document sharing. Distinct security model — a separate risk review is mandatory before any portal work starts.

### 4.3 Analytics / BI

Scope: nightly aggregation to a warehouse schema; Metabase or equivalent dashboards for clinic owners.

---

## Cross-phase concerns

### Testing strategy

Unit tests live next to the code (`*.spec.ts`). E2E tests in `backend/test/`. Frontend component tests via Vitest + Testing Library (to be set up in Phase 1.7). Playwright for E2E UI.

Coverage expectation:
- Services with financial / scheduling / permission / tenant-isolation logic: aim for ≥85% line coverage.
- DTOs and controllers: smoke-level coverage (one happy, one validation failure, one auth failure).
- Frontend: E2E smoke for the golden path; component tests only for non-trivial components (calendar, forms with cross-field validation).

### Branching & release

- Trunk-based: short-lived feature branches off `main`, one PR per workstream.
- Semantic tags on `main` for releases (`v0.1.0`, `v0.2.0` …). Phase exit = minor bump.
- Every merge to `main` must pass CI and be deployable to staging immediately.

### Migrations

Once Phase 2.5 lands: no schema change merges without an accompanying `migrate-mongo` migration. `pnpm migrate:up` runs on deploy before the app starts.

### Commit discipline

Commits describe the why (e.g., `fix(billing): idempotent payments via (clinicId, billId, idempotencyKey) unique partial index`). No bulk "WIP" commits. No co-author tags unless contributors explicitly exist.

---

## Risk register

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Header-based tenant-context bypass exploited | Cross-clinic PHI leak | High until 0.1 | Workstream 0.1 is first |
| Duplicate payment on retry | Financial reconciliation error | Medium | Workstream 0.5 |
| Public share token leak | PHI leak to the internet | Medium | Workstream 0.4 |
| TZ bugs in reports | Revenue misattribution across days | High (daily) | Workstream 0.3 + 2.1 |
| No replica set → TX fallback in prod | Race → double-booking | Low (latent) | Workstream 3.1 |
| Scaffold-only tests | Regressions ship | Certain | Workstream 0.6 + CI gating |
| Frontend is dev-console | Unusable by real clinics | Certain | Workstream 1.7 |
| No backups | Total data loss on disk failure | Low × High | Workstream 2.5 |

---

## Definition of "production-ready"

All of the following are true:

- [ ] Phases 0–3 exit bars all met.
- [ ] Zero `// placeholder` / `// TODO later` comments in hot paths (booking, billing, auth, share).
- [ ] CI green on `main` for 14 days; zero rollbacks in last 2 releases.
- [ ] At least one pilot clinic running on staging for 2 weeks with real (anonymized or consented) data.
- [ ] Pen test remediation list closed or accepted with sign-off.
- [ ] DR drill completed: full restore from backup in under the documented RTO.
- [ ] On-call rotation staffed and alerts tuned (no more than 1 false page / week).
- [ ] Customer-support runbook exists for the top 10 anticipated tickets (reset password, re-print bill, void payment, resend share link, …).

---

## Suggested order of execution

1. Phase 0 in order (0.1 → 0.8) — sequential, because 0.2 and 0.6 depend on 0.1 being in place.
2. Phase 1 workstreams can partially parallelize:
   - 1.1, 1.2, 1.3, 1.5 are independent (different modules).
   - 1.4 depends on 1.1 (patient lookup in booking).
   - 1.7 blocks on 1.1–1.5 (needs real backend endpoints to build real UI against).
3. Phase 2 workstreams are mostly independent and can fan out.
4. Phase 3 is mostly ops + platform — a small team should own it end to end.
5. Phase 4 only after Phase 3 stable for 4+ weeks.

## When to spawn a new plan

Before starting any workstream above, spawn a concrete execution plan for it via `superpowers:writing-plans`, save it under `docs/superpowers/plans/YYYY-MM-DD-<workstream-id>.md`, then execute it via `superpowers:subagent-driven-development`. The acceptance criteria in this roadmap become the plan's test assertions.
