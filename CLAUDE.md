# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Split repo — each package has its own `package.json` and lockfile:

- `backend/` — NestJS 11 API on MongoDB (Mongoose 9), Redis + BullMQ, MinIO/S3. Runs on port 4000.
- `frontend/` — React 19 + Vite 8 + Tailwind 3 (mobile-first shell). Runs on port 5173.
- `docker-compose.yml` — MongoDB, Redis, MinIO (+ bucket init). Runs all three at root.
- `clinic-management-implementation-plan.md` — the authoritative product/phasing/data-model spec. Use this as the source of truth for requirements (entities, permissions, phases).

Package manager is **pnpm**. Do not introduce `npm`/`yarn` lockfiles.

## Common commands

Infra (root):
```bash
docker compose up -d        # mongo, redis, minio (bucket auto-created by minio-init)
```

Backend (`cd backend/`):
```bash
pnpm install
pnpm start:dev              # nest start --watch (port 4000)
pnpm seed                   # seed Demo Clinic + admin user; prints clinicId/branchId/login
pnpm build                  # nest build -> dist/
pnpm start:prod             # node dist/main
pnpm lint                   # eslint --fix
pnpm test                   # jest (testRegex: .*\.spec\.ts$, rootDir src)
pnpm test -- path/to/file.spec.ts         # single test file
pnpm test -- -t "describe or it name"     # filter by name
pnpm test:e2e               # jest --config ./test/jest-e2e.json
pnpm fix:indexes:appointments             # one-off: drop legacy appt_queue_unique_idx
```

Frontend (`cd frontend/`):
```bash
pnpm install
pnpm dev                    # vite (port 5173)
pnpm build                  # tsc && vite build (strict TS)
pnpm preview
```

There is no root-level `package.json` — always `cd` into `backend/` or `frontend/` first, or use `pnpm -C backend <cmd>`.

## Architecture

### Multi-tenant request context (backend)

Every non-auth route runs through `ClinicContextMiddleware` (`backend/src/common/clinic-context.middleware.ts`), which populates `req.context = { clinicId, branchId?, actorUserId? }` from **either**:
1. `Authorization: Bearer <jwt>` — claims are verified with `JWT_ACCESS_SECRET`; `clinicId`/`branchId`/`sub` come from the token.
2. Dev fallback headers: `x-clinic-id` (required), `x-branch-id`, `x-user-id` — **only** when `NODE_ENV !== 'production'` AND `ALLOW_DEV_AUTH_HEADERS=true`.

`/auth/**` and `/health` are excluded. Every service method takes `clinicId: Types.ObjectId` and filters on it — **never** query a collection without a `clinicId` match; cross-tenant leakage is the primary security concern.

`req.context.clinicId` is already an `ObjectId` by the time it reaches controllers (parsed via `parseObjectId`). Do not re-parse it.

### AuthZ

- `Permission` enum in `backend/src/modules/authz/permissions.ts` is the complete permission set. Roles are stored per-clinic with a `permissions: Permission[]` array.
- `PermissionsGuard` is registered as a global `APP_GUARD`. It reads `@RequirePermissions(...)` metadata from the handler/class. Guard is **default-deny**: a handler without `@RequirePermissions(...)` or `@Public()` returns 403. Use `@RequirePermissions()` (empty args) for routes that need a tenant context but no specific capability (`/me`). Use `@Public()` only for truly unauthenticated routes (`/auth/*`, `/health`, `/share/*`).
- `AuthzService.getActor(...)` loads the user + roles and flattens permissions. It throws 401 if `actorUserId` is missing — so permissioned routes require either a JWT or `x-user-id`.

### Auditing & access logs

- `AuditInterceptor` is a global `APP_INTERCEPTOR` that writes an `AuditLog` for POST/PATCH/PUT/DELETE after a successful response (fire-and-forget). `entityType` is derived from the route path; `entityId` from `req.params.id`. GET requests are not audited.
- `AccessLogMiddleware` (in `modules/access-logs/`) writes a row on `res.on('finish')` for all non-health requests that have a `req.context`. Also fire-and-forget.

### Appointments: conflict prevention

`AppointmentsService.create()` (`backend/src/modules/appointments/appointments.service.ts`) is the critical correctness path. It:

1. For `TIME`: calls `AvailabilityService.assertTimeSlotAllowed` (validates against doctor's weekly rules + overrides, computed in the clinic timezone via Luxon), then does an **overlap check inside a Mongo transaction** (`$lt endAt` && `$gt startAt` against `ACTIVE_TIME_STATUSES`). If the Mongo deployment is a standalone (not a replica set), it gracefully falls back to a non-transactional check — detected by the error string `"Transaction numbers are only allowed"`. Preserve this fallback when editing; dev uses a standalone mongo.
2. For `QUEUE`: atomically increments `QueueCounter` with `findOneAndUpdate({ upsert: true, $inc })` scoped by `(clinicId, branchId, doctorId, queueDate)`.
3. `queueDate` is a `YYYY-MM-DD` string in clinic-local time (not a UTC Date).

Unique index `appt_queue_unique_idx` uses `partialFilterExpression: { type: QUEUE }` so TIME docs (with null queueDate/queueNumber) don't collide. `pnpm fix:indexes:appointments` drops the pre-partial legacy index if a DB was seeded before that change.

### Clinic settings

Settings are stored as an opaque `Record<string, unknown>` on `Clinic.settings`. Read them through `mergeClinicSettings(raw)` in `backend/src/modules/tenancy/clinic-settings.types.ts` — it fills defaults and coerces invalid values. New settings must be added there so downstream code sees a typed shape.

### Notifications

`NotificationsModule.forRoot()` conditionally wires BullMQ + the worker: only when `NOTIFICATIONS_QUEUE_ENABLED=true` **and** `REDIS_URL` is set are `BullModule` and `NotificationsProcessor` registered. `NotificationsService.enqueueSend` always writes a `NotificationLog` row (status `Queued`), and only calls `queue.add(...)` if the queue is present — so leaving queue disabled in dev is safe; messages accumulate as logs.

`NotificationsScheduler` runs `@Cron('*/5 * * * *')` and looks for appointments starting in each `REMINDER_WINDOWS_MINUTES` window (default `1440,120`) using a 5-minute bucket. Templates are per-clinic + per-channel; a fallback body is used if no template matches.

### Storage (documents)

`StorageService` talks to S3-compatible storage (MinIO in dev). `S3_FORCE_PATH_STYLE=true` is required for MinIO. The standard document flow is presigned-PUT → record `Document` row → later presign-GET for download; `Document.access` is either `INTERNAL_ONLY` or `SHAREABLE_WITH_TOKEN` (token-based public sharing lives in `DocumentShare`).

Public share endpoints (`GET /share/:token` for documents, `GET /share/prescriptions/:token`) enforce expiry, revocation, and (for documents) `maxViews` in `DocumentsService.shareDownload` / `PrescriptionsService.getByShareToken`. Invalid/expired/revoked → 404; doc-share view limit reached → 410. `maxViews` is enforced atomically via `findOneAndUpdate` + `$inc(viewCount)` + `$lt` guard. Revoke via `POST /documents/:id/share/revoke` (`document:write`) or `POST /prescriptions/:id/share/revoke` (`patient:write`).

### Patient search

`PatientsService` maintains `normalizedName` and `normalizedPhones` alongside the raw fields; search queries these normalized variants (see `patient.utils.ts`). Always populate both on write.

### Billing

`BillingService` enforces state transitions: bills are created as `Draft`, finalized via `issueBill` (assigns `billNo`), and only issued bills accept payments. Totals are computed centrally in `computeTotals` (`billing.utils.ts`) — call it whenever `items/discount/tax` change.

`POST /bills/:id/payments` requires a client-generated `idempotencyKey` (8–64 chars; UUIDv4 in the FE). A repeat POST with the same key on the same bill returns the original payment with `X-Idempotent-Replay: true`, enforced by a partial unique index on `(clinicId, billId, idempotencyKey)`. The service returns `{ payment, replayed }` and the controller maps `replayed` to the response header.

### Frontend

- Mobile-first shell (`MobileShell.tsx`) with a bottom tab bar — `home | patients | appointments | billing | reports | me`. `App.tsx` switches screens based on the active tab; there is no router.
- API calls go through `frontend/src/app/api.ts`: `apiFetch` attaches `Authorization: Bearer <accessToken>` (or falls back to `x-user-id` for dev), always sends `x-clinic-id` / `x-branch-id`, uses `credentials: 'include'` (for the refresh cookie), and on a 401 transparently calls `/auth/refresh` and retries once. Persist updated tokens via `saveContext`.
- Dev context is persisted in `localStorage` under `digirx.devContext.v1`. The `MeScreen` is the setup surface for clinicId/branchId/userId/token.
- Tailwind theme defines a `brand` palette + pastel gradients in `tailwind.config.js`; prefer those tokens over raw hex.

## Environment

Backend `.env` keys (see `backend/.env.example`): `PORT`, `MONGODB_URI`, `REDIS_URL`, `S3_*`, `NOTIFICATIONS_QUEUE_ENABLED`, `REMINDER_WINDOWS_MINUTES`, `FRONTEND_ORIGIN`/`CORS_ORIGINS`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_DAYS`, `SEED_ADMIN_PASSWORD`.

Frontend `.env`: `VITE_API_BASE_URL` (defaults to `http://localhost:4000`).

CORS in `main.ts` uses a callback allowlist — to add an origin, prefer `CORS_ORIGINS=` (comma-separated) over editing the code.

## Conventions

- Use `@nestjs/mongoose` decorators + `@Schema({ timestamps: true })` on all collections. Always index `clinicId` (and `branchId` where applicable).
- DTOs live under `modules/<x>/dto/` and use `class-validator` decorators. A global `ValidationPipe` in `main.ts` enforces them with `whitelist: true, forbidNonWhitelisted: true, transform: true`; bad bodies are rejected with 400 before the handler runs. Per-DTO specs under `*.dto.spec.ts` assert both the happy path and at least one rejection case; use the `expectInvalid` / `expectValid` helpers in `backend/src/common/test/dto-validator.ts`. `reflect-metadata` is loaded for every Jest test via `setupFiles` in `backend/package.json`.
- Controllers should stay thin: tenant extraction (`req.context!.clinicId`) + delegation to services. Never reach into Mongoose models from a controller.
- Timezone-sensitive logic goes through Luxon (`DateTime`), using the clinic's stored `timezone`. `queueDate` is a local-date string; timestamps (`startAt`, `endAt`, `visitedAt`, …) are UTC `Date`s.
