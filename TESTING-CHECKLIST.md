# DigiRx — QA Testing Checklist

Module-wise test plan for distribution across QA / engineering colleagues.

**How to use**
- Each section maps to a backend module under `backend/src/modules/` and/or a frontend screen under `frontend/src/ui/screens/`.
- Fill in **Owner** and tick **Status** as cases are completed (Pass / Fail / Blocked).
- Priorities: **P0** = release-blocker, **P1** = major, **P2** = minor / polish.
- Test environments:
  - **Local**: `docker compose up -d` (root) + `pnpm start:dev` (backend) + `pnpm dev` (frontend).
  - Use `pnpm seed` (backend) to get a Demo Clinic + admin login.
- For backend-only cases, hit the API directly via Postman/curl using either a real JWT or dev headers (`x-clinic-id`, `x-branch-id`, `x-user-id`) when `NODE_ENV != production` and `ALLOW_DEV_AUTH_HEADERS=true`.

---

## 0. Cross-cutting (assign to senior / lead) — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 0.1 | P0 | **Multi-tenant isolation**: Seed two clinics. Verify that a request signed for clinic A cannot read/write any record from clinic B (patients, appointments, bills, encounters, documents). Try direct ID access too. |
| 0.2 | P0 | **Auth gate**: Confirm every non-`/auth/*` and non-`/health` route returns 401 without JWT/dev headers. |
| 0.3 | P0 | **Default-deny permissions**: A handler with no `@RequirePermissions(...)` and no `@Public()` returns 403 — verify by checking a sample of routes. |
| 0.4 | P0 | **Dev-header fallback off in prod**: Set `NODE_ENV=production` (or unset `ALLOW_DEV_AUTH_HEADERS`). Confirm `x-clinic-id` headers are ignored and JWT is required. |
| 0.5 | P1 | **CORS**: Add an origin to `CORS_ORIGINS` and verify it is allowed; remove it and verify it is rejected. |
| 0.6 | P1 | **Audit log**: After POST/PATCH/PUT/DELETE on any module, verify an `AuditLog` row was written with the correct `entityType`, `entityId`, and `actorUserId`. GET should NOT be audited. |
| 0.7 | P1 | **Access log**: Verify `AccessLog` rows accumulate for non-health requests with `req.context`. |
| 0.8 | P1 | **Validation pipe**: Send an unknown field in any DTO body — confirm 400 (forbidNonWhitelisted). Send a wrong type — confirm 400. |
| 0.9 | P2 | **Timezone**: Switch the clinic timezone and verify queueDate strings, appointment day grouping, and reminder windows shift accordingly. |

---

## 1. Auth — `modules/auth` + `LoginScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 1.1 | P0 | Login with seeded admin credentials → returns access + refresh tokens, sets refresh cookie. |
| 1.2 | P0 | Login with wrong password → 401, no token. |
| 1.3 | P0 | Login with non-existent email → 401, identical error shape (no user enumeration). |
| 1.4 | P0 | `/auth/refresh` with a valid refresh cookie → returns a new access token; old still valid until TTL. |
| 1.5 | P0 | `/auth/refresh` with no cookie / tampered cookie → 401. |
| 1.6 | P1 | Token TTL: wait past `JWT_ACCESS_TTL` and confirm the FE auto-refreshes via `apiFetch` 401 handler. |
| 1.7 | P1 | Logout: clears refresh cookie; subsequent `/auth/refresh` returns 401. |
| 1.8 | P1 | Multiple parallel refresh calls do not produce duplicate tokens / race the cookie. |
| 1.9 | P2 | Login UI: invalid email format triggers FE-side validation; loading state visible while request is in flight. |

---

## 2. Tenancy & Clinic Settings — `modules/tenancy` + `SettingsScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 2.1 | P0 | Read clinic settings → defaults are merged (via `mergeClinicSettings`) when raw value is missing/invalid. |
| 2.2 | P0 | Update settings (e.g. timezone, branding) → persists; subsequent read returns merged shape. |
| 2.3 | P1 | Branch CRUD: create / list / update branches; verify `branchId` scoping on related modules afterward. |
| 2.4 | P1 | SettingsScreen reflects backend changes; saving disabled until form dirty; success toast on save. |
| 2.5 | P2 | Invalid setting value (e.g. malformed timezone) is coerced or rejected with a clear error. |

---

## 3. AuthZ / Roles & Permissions — `modules/authz` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 3.1 | P0 | Create a role with a subset of `Permission` enum values; assign to user; verify only matching routes succeed. |
| 3.2 | P0 | Remove a permission from a role → routes requiring it return 403 immediately for that user. |
| 3.3 | P1 | `/me` returns current actor + flattened permissions; works with empty `@RequirePermissions()`. |
| 3.4 | P1 | User with no roles → 403 on permissioned routes; 401 if `actorUserId` missing entirely. |
| 3.5 | P2 | A role that exists in clinic A is not visible / usable in clinic B. |

---

## 4. Patients — `modules/patients` + `PatientsScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 4.1 | P0 | Create patient (full name, DOB, gender, phones, tags) → record persisted with `normalizedName` and `normalizedPhones`. |
| 4.2 | P0 | Search by partial name — returns hits across casing/diacritics. |
| 4.3 | P0 | Search by phone (with/without country code, with spaces/dashes) — returns same patient. |
| 4.4 | P1 | Update name / phones → both raw and normalized fields are updated together. |
| 4.5 | P1 | Patient documents sub-resource: upload via patient's documents endpoint, list, delete; verify `clinicId` scoping. |
| 4.6 | P1 | PatientsScreen: skeleton loader visible while fetching; empty state when no results; pagination/scroll works. |
| 4.7 | P2 | Tags CRUD on patient — duplicate tag rejected or de-duped. |
| 4.8 | P2 | Long names / unicode (Hindi, Arabic) render correctly in list and detail. |

---

## 5. Availability — `modules/availability` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 5.1 | P0 | Define weekly availability for a doctor; query schedule for a given date — returns slots in clinic timezone. |
| 5.2 | P0 | Add an override (holiday / extra slot) — overrides take precedence over weekly rules. |
| 5.3 | P1 | Booking outside availability → `assertTimeSlotAllowed` rejects with a meaningful error. |
| 5.4 | P2 | Doctor with no availability defined → endpoint returns empty (not 500). |

---

## 6. Appointments — `modules/appointments` + `AppointmentsScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 6.1 | P0 | **TIME** booking: create within availability → 201; conflicting overlap → 409. |
| 6.2 | P0 | **TIME** transaction fallback: on a standalone Mongo (dev), overlap check still works without `Transaction numbers` error. |
| 6.3 | P0 | **QUEUE** booking: first token gets `queueNumber=1`; subsequent same-day same-doctor → 2, 3, … (atomic increment). |
| 6.4 | P0 | `queueDate` is the local clinic-day string `YYYY-MM-DD`, not UTC. Verify around DST / midnight UTC. |
| 6.5 | P0 | Two concurrent QUEUE bookings (parallel POSTs) for same doctor/date → distinct sequential numbers, no duplicates. |
| 6.6 | P0 | Status transitions: `BOOKED → CHECKED_IN → IN_PROGRESS → DONE`; cancel possible from BOOKED/CHECKED_IN. |
| 6.7 | P1 | Day view shows skeleton loader (just fixed); week view shows skeleton bars per day; queue view shows list-item skeletons. |
| 6.8 | P1 | Day-of date arrows shift the date and refetch; Today button (if present) returns to current. |
| 6.9 | P1 | Booking sheet: patient search by name/phone, doctor selection, type toggle, validation when fields missing. |
| 6.10 | P2 | Cancelled / no-show appointments do NOT count toward overlap conflicts. |
| 6.11 | P2 | Run `pnpm fix:indexes:appointments` against a DB seeded before the partial index → legacy index dropped, no data loss. |

---

## 7. Encounters — `modules/encounters` + `EncounterScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 7.1 | P0 | Start encounter from an appointment → `appointmentId` linked, `visitedAt` set, status `DRAFT`. |
| 7.2 | P0 | Save draft (vitals, complaint, diagnosis, notes, follow-up) → PATCH persists; reload shows same values. |
| 7.3 | P0 | Sign encounter → status `SIGNED`, `signedAt` + `signedByUserId` set; subsequent edits are blocked (UI disabled + API rejects). |
| 7.4 | P0 | Prescriptions are created via a separate `POST /encounters/:id/prescriptions` (encounter and rx are independent records). Verify: a `POST /encounters/:id/prescriptions` with rx items writes a Prescription linked to the encounter; the subsequent `POST /encounters/:id/sign` does NOT mutate or duplicate the prescription. |
| 7.5 | P1 | Vitals: numeric fields accept decimals; empty fields stripped from payload. |
| 7.6 | P1 | Diagnosis chip add/remove (`|`-joined) round-trips correctly. |
| 7.7 | P1 | Encounter form (start screen) renders top-left (just fixed), not centered. |
| 7.8 | P2 | Cannot sign without `patient:write` (or whatever permission is configured). |
| 7.9 | P2 | Two users editing the same draft — last-write-wins is acceptable; verify no data corruption. |

---

## 8. Prescriptions & Public Sharing — `modules/prescriptions` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 8.1 | P0 | Create prescription tied to encounter → items persisted; PDF generation works. |
| 8.2 | P0 | Generate share token (`POST /prescriptions/:id/share`) → public `GET /share/prescriptions/:token` returns prescription. |
| 8.3 | P0 | Expired token → 404. Revoked token (`POST /prescriptions/:id/share/revoke`) → 404 immediately. |
| 8.4 | P1 | Token without expiry → still valid until revoked. |
| 8.5 | P1 | Share endpoint does not require auth (verify it's `@Public()`). |
| 8.6 | P2 | Share URL renders prescription on mobile + desktop browsers. |

---

## 9. Billing & Payments — `modules/billing` + `BillingScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 9.1 | P0 | Create bill in `Draft` → totals computed via `computeTotals` for given items/discount/tax. |
| 9.2 | P0 | Update items/discount/tax on Draft → totals recomputed correctly (including rounding). |
| 9.3 | P0 | Issue bill → assigns `billNo` (format `<branchHex>-YYYYMMDD-<billHex>`; unique but ID-based, NOT a strictly incrementing counter), status `Issued`, `issuedAt` timestamped. Cannot edit items after issuing (`Issued` and `Paid` are both immutable). |
| 9.4 | P0 | **Payment idempotency**: POST `/bills/:id/payments` with `idempotencyKey` X → 201, `payment.replayed=false`. Repeat with same key → returns same payment, `X-Idempotent-Replay: true` header. |
| 9.5 | P0 | Different idempotency key on same bill → creates a new payment row. |
| 9.6 | P0 | Payment on a `Draft` bill → rejected (only Issued accepts payments). |
| 9.7 | P0 | Sum of payments = bill total → status moves to `Paid`. |
| 9.8 | P1 | Idempotency key length validation: <8 or >64 chars → 400. |
| 9.9 | P1 | Concurrent same-key payments (race) → exactly one payment row (partial unique index). |
| 9.10 | P1 | Void bill → cannot accept new payments. |
| 9.11 | P1 | BillingScreen: skeleton loader on list; bill detail PDF download; FE generates UUIDv4 idempotency keys. |
| 9.12 | P2 | Currency formatting (`formatINR`) handles 0, null, very large numbers. |

---

## 10. Documents & Storage — `modules/documents`, `modules/storage` + `DocumentsScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 10.1 | P0 | Request presigned PUT → upload to MinIO via the URL → record `Document` row → presigned GET returns the file. |
| 10.2 | P0 | `S3_FORCE_PATH_STYLE=true` works against MinIO; verify dev compose bucket is auto-created by `minio-init`. |
| 10.3 | P0 | Create share token with expiry + maxViews. `GET /share/:token` increments viewCount atomically; on `viewCount >= maxViews` → 410. |
| 10.4 | P0 | Expired share → 404; revoked share (`POST /documents/:id/share/revoke`) → 404. |
| 10.5 | P1 | `INTERNAL_ONLY` documents never expose a working share URL. |
| 10.6 | P1 | Concurrent share GETs at the maxViews threshold → only `maxViews` succeed (atomic guard). |
| 10.7 | P2 | DocumentsScreen: upload progress, list, delete, preview for common types (PDF, image). |

---

## 11. Notifications — `modules/notifications` + `NotificationsScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 11.1 | P0 | With `NOTIFICATIONS_QUEUE_ENABLED=false`: `enqueueSend` writes a `NotificationLog` row (status `Queued`) and does NOT crash. |
| 11.2 | P0 | With queue enabled + Redis up: BullMQ job is created; processor runs; log status moves to `Sent` / `Failed`. |
| 11.3 | P1 | Scheduler cron: appointments starting inside each `REMINDER_WINDOWS_MINUTES` window are picked up exactly once per 5-min bucket. |
| 11.4 | P1 | Per-clinic, per-channel template lookup — falls back to default body when no template matches. |
| 11.5 | P1 | NotificationsScreen list: skeleton on load, status pills, retry/cancel actions if exposed. |
| 11.6 | P2 | Disable a channel mid-flight — no further sends to that channel; no orphaned jobs. |

---

## 12. Reports & Dashboard — `modules/reports` + `DashboardScreen.tsx`, `ReportsScreen.tsx` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 12.1 | P0 | Dashboard KPIs match raw DB counts for: today's appointments, walk-ins, signed encounters, billed total. |
| 12.2 | P0 | Date-range filter on Reports updates all charts; clinic timezone applied to day buckets. |
| 12.3 | P1 | Empty state when no data in range; skeleton during fetch. |
| 12.4 | P1 | Export (CSV/PDF) if exposed: file downloads, columns match table. |
| 12.5 | P2 | Sparkline rendering for very short / single-point series does not crash. |

---

## 13. PDF — `modules/pdf` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 13.1 | P0 | Prescription PDF renders all rx items, doctor signature line, clinic header. |
| 13.2 | P0 | Bill PDF: items table, totals, paid stamp when applicable. |
| 13.3 | P1 | Long content paginates correctly (no overflow / cut text). |
| 13.4 | P2 | Unicode (Hindi/Tamil) text renders in PDF without tofu boxes. |

---

## 14. Audit & Access Logs — `modules/audit`, `modules/access-logs` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 14.1 | P0 | Mutation routes write `AuditLog` after a 2xx response; failed (4xx/5xx) requests do NOT. |
| 14.2 | P0 | `AccessLog` written for every non-health request with a context. |
| 14.3 | P1 | Both writes are fire-and-forget — a DB hiccup on logs does not fail the parent request. |
| 14.4 | P1 | Logs are clinic-scoped; admin from clinic A cannot read clinic B's logs. |
| 14.5 | P2 | Log list endpoints (if any) paginate and filter by user / entity / date range. |

---

## 15. Frontend Shell & Dev Context — `MobileShell.tsx`, `MeScreen` — Owner: ______

| # | Priority | Test |
| - | -------- | ---- |
| 15.1 | P0 | Bottom tab bar switches between `home / patients / appointments / billing / reports / me` correctly; selected tab persists across reloads if expected. |
| 15.2 | P0 | `apiFetch` attaches `Authorization` (or `x-user-id` fallback) + `x-clinic-id` + `x-branch-id`; uses `credentials: 'include'`. |
| 15.3 | P0 | 401 → silent `/auth/refresh` retry once; on second 401 → redirect to LoginScreen. |
| 15.4 | P1 | MeScreen: change clinicId/branchId/userId/token → context persisted to `localStorage` key `digirx.devContext.v1`. |
| 15.5 | P1 | Tailwind brand tokens / pastel gradients used consistently — no raw hex creeping in (sample 5 screens). |
| 15.6 | P2 | Mobile viewport (375×812): no horizontal scroll, all CTAs reachable, modals/sheets fit. |
| 15.7 | P2 | Keyboard navigation on web: Tab order is sensible; focus-visible rings present. |

---

## Suggested distribution

| Group | Owner suggestion | Sections |
| ----- | ---------------- | -------- |
| **A — Core data & multi-tenant** | Senior backend | 0, 1, 2, 3 |
| **B — Clinical flows** | Backend + clinical SME | 4, 5, 6, 7, 8 |
| **C — Money flows** | Backend + finance reviewer | 9 |
| **D — Files & messaging** | Backend + DevOps | 10, 11, 13 |
| **E — Reporting & ops** | BI / analytics | 12, 14 |
| **F — Frontend / UX** | Frontend + designer | 6.7–6.9, 7.7, 9.11, 10.7, 11.5, 12.3, 15 |

---

## Reporting

For each failed case, file a bug with:
- Module / test ID (e.g. `9.4`)
- Steps to reproduce + payloads (redact secrets)
- Expected vs actual
- Environment (commit SHA, browser, mongo type — replica set / standalone)
- Screenshots / response body

Track in your usual tracker; tag with `qa-r1` (or whichever release tag).
