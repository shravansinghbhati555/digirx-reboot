# Patient portal — design proposal

> **Status:** proposal. No implementation in this pass — Phase 4.1 (inventory)
> and 4.3 (analytics) are shipping; 4.2 (portal) is intentionally a design
> doc because the security model is different from the staff app and it
> deserves a dedicated security-review pass before any code lands.

## What this is

A separate, public-facing application that lets patients:

- Log in with **their phone number + an OTP** (no passwords).
- See their own appointments, prescriptions, and bills.
- Book / cancel / reschedule **future** TIME appointments within rules
  the clinic has set (allowed doctors, lead-time, blackout dates).
- Download their prescription PDF.
- Update soft profile fields (preferred phone, email, address).

What it explicitly is **not**:

- A clinical interface (no encounter editing, no diagnosis writes).
- A way to see *other* patients (each token is bound to a single
  patientId in a single clinicId).
- A staff console (the existing FE keeps doing that job).

## Why a separate app

- **Different security model.** Staff sessions are JWT-from-password;
  portal sessions are JWT-from-OTP. Staff sessions have role permissions;
  portal sessions have a single hard-coded role: `portal:patient`.
  Mixing both into one app risks accidentally exposing a staff endpoint
  to a portal-authenticated user.
- **Different audience.** Patients use it once a month from a phone with
  spotty connectivity. The shell needs to be lighter (no calendar grid,
  no admin matrices), which means a different UX skeleton anyway.
- **Different deployment surface.** The portal is the most-attacked
  entry point — public OTP, public reset flow. Keeping it on a separate
  origin lets us scope CSP, rate-limiting, and WAF rules tighter
  without burdening the staff app.

## Endpoint sketch

All paths are prefixed `/portal/` to make the auth scope unambiguous in
logs, throttler config, and the audit trail.

### Auth

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/portal/auth/request-otp` | `{ phone, clinicId }` | `{ ok: true, ttl: 300 }` |
| POST | `/portal/auth/verify-otp`  | `{ phone, clinicId, otp }` | `{ accessToken, patientId }` + `digirx_portal_refresh` cookie |
| POST | `/portal/auth/refresh` | (cookie) | `{ accessToken }` |
| POST | `/portal/auth/logout`  | (cookie) | `{ ok: true }` |

- OTPs are 6-digit numeric, 5-min TTL, single-use, max 5 attempts before
  the OTP row is invalidated.
- `request-otp` is rate-limited to **3/min per phone** and **10/hour per
  IP**. Successful issue rate-limited to **1/min per phone** to suppress
  enumeration probes.
- An "unknown" phone+clinic combination still returns `{ ok: true }` —
  no existence oracle, same posture as our share-token endpoints.
- The OTP itself is delivered through `NotificationsService` using the
  existing Twilio SMS provider. The body uses a clinic-overridable
  template (`portal_otp` template key).

### Identity

| Method | Path | Returns |
|---|---|---|
| GET | `/portal/me` | `{ patient: {…safe fields…}, clinic: {…public fields…} }` |
| PATCH | `/portal/me` | accepts `phones`, `emails`, `address`. Updates the patient row + writes an AuditLog with `actorUserId: null, actorPatientId: …`. |

### Read-only access to clinical data

| Method | Path | Returns |
|---|---|---|
| GET | `/portal/appointments?from&to` | upcoming + recent past appointments |
| GET | `/portal/prescriptions` | list, newest first |
| GET | `/portal/prescriptions/:id/pdf` | presigned URL for the patient's own rx |
| GET | `/portal/bills` | issued/paid bills, with payment + outstanding |
| GET | `/portal/bills/:id/pdf` | presigned URL |

Every handler **filters by `req.portalContext.patientId`** — same shape
as `req.context.clinicId` for staff routes. Forgetting to filter is the
canonical bug here, so the controller wrappers should accept a
`patientId` arg explicitly rather than reaching into `req` (mirror the
staff convention).

### Self-service booking

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/portal/booking/doctors` | — | list of doctors the clinic has marked patient-bookable |
| GET | `/portal/booking/slots?doctorId&date` | — | reuses existing `availability.getDaySlots` |
| POST | `/portal/booking` | `{ doctorId, branchId, startAt, endAt }` | creates a TIME appointment with `source: PATIENT_PORTAL` |
| POST | `/portal/booking/:id/cancel` | `{ reason? }` | only the patient's own appointments, only if `startAt > now + cancellationLeadTime` |

Bookings honour clinic settings:

- `portal.bookingEnabled: boolean` — top-level on/off.
- `portal.bookableDoctorIds: ObjectId[]` — explicit allowlist; opt-in per doctor.
- `portal.cancellationLeadTimeHours: number` — minimum hours before
  startAt that a patient can cancel themselves.
- `portal.maxAdvanceDays: number` — how far in advance a patient can
  book (default 30).

## Security model

### Auth realm

Portal JWTs are signed with **a separate secret** (`JWT_PORTAL_SECRET`)
from the staff `JWT_ACCESS_SECRET`. A staff token never passes a portal
guard and vice-versa, even by accident — the verifier rejects the
signature.

The portal token claims:

```ts
{
  sub: patientId,         // not userId — different namespace
  cid: clinicId,
  scope: 'portal:patient',
  exp: <8h>,
}
```

Refresh cookie: `digirx_portal_refresh` (different name from staff
cookie). Path scoped to `/portal/auth`, `secure`, `sameSite: strict`.

### Permission system

Portal handlers don't go through `PermissionsGuard`. Instead, a
dedicated `PortalContextMiddleware` populates `req.portalContext = {
patientId, clinicId }` from the portal JWT, and a `PortalGuard` rejects
any request whose token isn't of `scope: 'portal:patient'`.

This intentionally avoids granting a `portal:*` permission via the
existing role system — a staff role can't be misconfigured to grant
patient access.

### Rate-limiting

Three buckets above the global default:

| Bucket | Limit | TTL | Applies to |
|---|---|---|---|
| `portal-auth` | 10/min/IP | 60s | `/portal/auth/*` |
| `portal-otp-issue` | 3/min/phone, 10/hour/IP | 60s + 1h | `request-otp` |
| `portal-read` | 60/min/patient | 60s | every other portal route |

OTP brute-force is the thing that kills you here; the per-phone limit is
the most important.

### Audit + access logs

Every portal write writes an `AuditLog` row with `actorPatientId` set
(new field) and `actorUserId: null`. Reads from the portal write to
`AccessLog` with `path` prefix `/portal/`. Both feed the existing TTL
retention.

PII redaction (`redactPII`) already strips OTPs from any logged body.

### Threat model — top hits to consider in the security review

1. **OTP enumeration** — see rate-limiting above. The `request-otp`
   endpoint must always return `{ ok: true }` regardless of whether the
   phone exists, and the per-phone limiter must apply equally.
2. **Token replay across clinics** — two clinics with overlapping
   patient phones. Solution: OTP record carries `(clinicId, phone)`; the
   issued JWT carries `clinicId`; the verifier rejects a token whose
   `clinicId` doesn't match the route's `req.context.clinicId`.
3. **PII via download URLs** — presigned URLs leak via referer headers,
   browser history, screenshots. Mitigations: 5-min expiry (already in
   place), force `inline=false` for portal downloads (browser saves
   instead of inlining → no referer).
4. **Cross-tenant via `clinicId` tampering in request body** — every
   handler must use `req.portalContext.clinicId`, never the body. Same
   discipline as the staff routes.
5. **Stolen refresh cookie** — sameSite=strict + secure are the
   baseline. Add session revocation: a `portalSessions` collection
   with `expiresAt` TTL and `revokedAt`; logout sets `revokedAt`; a
   force-logout-all-sessions admin endpoint sets it for every active
   session for a given patient.
6. **Booking-bot abuse** — a bot books every available slot for a
   doctor and never shows up. Mitigations: per-patient cap on active
   future appointments (3 by default, settable via clinic config),
   automatic cancellation after N no-shows in a rolling window.

## Frontend structure

A separate Vite app at `portal/`. Sibling to `frontend/`, with its own
`package.json`, `Dockerfile`, and `nginx.conf` (CSP scoped to the
portal origin).

```
portal/
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── Dockerfile
├── nginx.conf
└── src/
    ├── main.tsx
    ├── App.tsx                  # BrowserRouter, OTP gate, routes
    ├── app/
    │   ├── api.ts               # narrow client; refresh cookie path /portal/auth
    │   ├── PortalContext.tsx    # patientId + clinicId from /portal/me
    │   └── routes.ts
    ├── ui/
    │   ├── shared/              # Button, Field, Sheet — copy from `frontend/`
    │   ├── auth/
    │   │   ├── PhoneEntry.tsx   # collect phone + clinicId
    │   │   └── OtpEntry.tsx     # 6-digit input
    │   ├── home/
    │   │   └── Home.tsx
    │   ├── appointments/
    │   │   ├── Upcoming.tsx
    │   │   └── BookingFlow.tsx  # doctor → date → slot → confirm
    │   ├── prescriptions/
    │   │   └── List.tsx
    │   └── bills/
    │       └── List.tsx
    └── tests/                    # Playwright golden-path mirroring staff app
```

Reuse where it doesn't compromise the auth boundary:

- The shared UI primitives (Button / Field / Sheet) can be copy-pasted.
  Don't `import` from `frontend/src/ui/shared` — that creates a coupling
  that will tempt someone to also reach into staff-only code paths.
- `formatMoney`, `formatDate`, `phoneticOf` — copy.
- `apiFetch` — copy and adapt (different cookie name + refresh path).

## Roadmap

A reasonable cut into shippable slices:

| Slice | Scope | Estimate |
|---|---|---|
| **PP-1** Auth realm only | Backend: portal auth + middleware + JWT secret + portalSessions schema. Twilio OTP send. **No FE.** Verifiable via curl. | 1 week |
| **PP-2** Read-only portal app | FE app with login + Home + Appointments list + Prescriptions list + Bills list + PDF download. Read-only. | 1 week |
| **PP-3** Self-service booking | Doctor allowlist + slot picker + book + cancel. Clinic settings + a Settings tab to manage them. | 1 week |
| **PP-4** Profile self-update | Patient can edit phone/email/address. Audit + rate-limit. | 3 days |
| **PP-5** Polish + security review | Pen test pass. Per-patient session list ("you're logged in on 2 devices"). Force-logout-all admin action. | 1 week |

Total ≈ 4-5 weeks of focused work, plus the security review window.

## Open questions for the next planning round

1. Does the clinic want patients to **see all their phones/emails on
   file**, or only the one they logged in with? (PII surface decision.)
2. Should portal users be able to download their **own audit trail**
   ("who at the clinic saw my record")? It's a strong trust signal but
   we'd need to redact internal-only fields.
3. Multi-clinic patients: a patient registered at two different DigiRx
   clinics — each clinic is its own tenant. Do they have one portal
   account that switches contexts (more UX work, schema change to allow
   `phone` to be unique per **person** not per clinic), or separate
   logins per clinic?
4. WhatsApp delivery for OTP? Twilio supports it; the latency is similar
   to SMS; the deliverability is better in some markets. Worth offering
   as a fallback when SMS fails.
