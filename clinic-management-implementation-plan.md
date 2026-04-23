# Clinic Management Platform — Implementation Plan

> **Purpose:** This is an execution-ready implementation plan derived from the provided requirements. It is written to be **phased**, **multi-tenant (clinic/branch isolated)**, **config-driven**, and **multi-country/timezone aware**.

**Goal:** Deliver a clinic operations platform that covers patient management, appointments, consultations/prescriptions, billing/payments, documents, notifications, RBAC, multi-branch support, and clinic-level configuration—while leaving inventory + patient portal as optional/future modules.

**Architecture:** Modular monolith first (single backend + single DB) with strong domain boundaries and an async job system for notifications and document generation. Design all data access as multi-tenant from day 1 (clinic + branch scoping), so scaling to multiple clinics is a deployment/config concern, not a rewrite.

**Primary entities:** Clinic, Branch, User, Role, Patient, Encounter/Visit, Appointment, Prescription, Bill, Payment, ServiceCatalogItem, Document, InventoryItem (optional), NotificationLog.

**Key constraints addressed:**
- **No double booking:** transactional/locking strategy at the DB level.
- **Hybrid inputs:** structured catalogs + free-text (medicine + services).
- **Secure documents:** signed URLs + access checks + audit logs.
- **Multi-country:** currency/phone/timezone are clinic-configured; no hard-coded assumptions.

---

## Scope & Phasing

### Phase 0 (Foundation)
- [ ] Multi-tenant model (Clinic + Branch) + RBAC + auditing
- [ ] Clinic configuration system (feature toggles + country/timezone/currency)
- [ ] Core data model + migrations + seed data
- [ ] File/document storage abstraction (S3-compatible recommended)
- [ ] Job queue + notification provider abstraction (SMS/WhatsApp)

### Phase 1 (Core clinic workflows)
- [ ] Patient management (profile, search, visit history, documents)
- [ ] Appointment management (time-based + queue-based, conflict prevention)
- [ ] Consultation “Encounter” workflow (notes + prescriptions)
- [ ] Prescription PDF generation + sharing link
- [ ] Billing (itemized services, discounts) + payments + bill PDF

### Phase 2 (Operational hardening)
- [ ] Reporting (daily schedule, revenue, pending payments, doctor-wise utilization)
- [ ] Notification reminders + retry + delivery logs + templates
- [ ] Better search (phonetic/name, phone) + performance indexing
- [ ] Access logs + export + backup policy

### Phase 3 (Optional modules)
- [ ] Inventory / in-house pharmacy (batch, expiry, low-stock alerts, billing deduction)
- [ ] Patient portal (booking + record access)

---

## High-level System Design

### Tenancy & Data Isolation Model

**Tenant keys:**
- `clinicId` (top-level tenant)
- `branchId` (operational scope; optional “all branches” visibility for central roles)

**Rule:** Every domain record MUST include `clinicId`. Most operational records also include `branchId` (appointments, encounters, billing), with explicit cross-branch views only via privileged roles.

**Access context computed per request:**
- `actor.userId`, `actor.clinicId`
- `actor.branchIds` (which branches they can access)
- `actor.permissions` (RBAC)
- `request.timezone` (clinic timezone default, with per-user override if desired)

### Module Boundaries (backend)
- **Identity & Access:** users, roles, permissions, sessions, audit logs
- **Clinic Config:** settings, feature flags, templates, working hours, holidays
- **Patients:** patient profile, identifiers, documents, history
- **Appointments:** scheduling, queue tokens, doctor availability
- **Encounters:** visit/consultation notes, diagnosis, observations
- **Prescriptions:** medicines, sig/dosage, pdf rendering, sharing
- **Billing:** bills, line items, discounts, payments, exports
- **Documents:** upload, metadata, linking, access checks
- **Notifications:** SMS/WhatsApp send, templates, retries, logs
- **Inventory (optional):** stock, batches, expiries, movements

### Storage & Integration
- **Database:** relational DB strongly recommended (PostgreSQL) for scheduling + billing consistency. (If you prefer NoSQL, you must implement stronger app-level constraints for conflicts and billing consistency.)
- **Object storage:** S3-compatible (AWS S3 / MinIO) with server-side encryption.
- **Queue:** Redis-backed (BullMQ / Sidekiq / Celery) for reminders, PDFs, provider retries.
- **Providers:** pluggable interfaces for SMS and WhatsApp (e.g., Twilio, Msg91, Gupshup).

---

## Data Model (Core)

### Clinic / Branch
- `Clinic`: `id`, `name`, `countryCode`, `timezone`, `currency`, `phoneCountryCode`, `settings`
- `Branch`: `id`, `clinicId`, `name`, `address`, `workingHours`, `holidayCalendarId`

### Users / Roles / Permissions
- `User`: `id`, `clinicId`, `email/phone`, `name`, `status`, `defaultBranchId`, `passwordHash/SSO`
- `Role`: `id`, `clinicId`, `name`, `permissions[]`
- `UserBranchAccess`: `userId`, `branchId`

**Suggested roles:**
- Admin (clinic-wide)
- BranchAdmin
- Doctor
- Reception/Staff
- BillingStaff
- Pharmacist (if inventory enabled)

### Patients
- `Patient`: `id`, `clinicId`, `primaryBranchId?`, `fullName`, `gender`, `dob`, `phones[]`, `emails[]`, `address`, `tags[]`, `notes`
- `PatientIdentifier`: `patientId`, `clinicId`, `type` (MRN/ExternalId), `value` (unique per clinic)
- `PatientMergeLog` (optional later): for duplicates

### Appointments
- `DoctorProfile`: `userId`, `clinicId`, `specialties[]`, `defaultSlotMinutes`, `visitFeeDefault?`
- `DoctorAvailability`: recurring schedule + overrides (branch-specific)
- `Appointment`:
  - `id`, `clinicId`, `branchId`, `doctorId`
  - `patientId`, `type` (TIME|QUEUE)
  - `startAt`, `endAt` (TIME) OR `queueDate`, `queueNumber` (QUEUE)
  - `status` (BOOKED|CHECKED_IN|IN_PROGRESS|DONE|CANCELLED|NO_SHOW)
  - `source` (FRONT_DESK|PATIENT_PORTAL|INTERNAL)
  - `notes`, `createdBy`, `createdAt`

**Conflict prevention strategy (TIME appointments):**
- DB-level exclusion constraint (Postgres `EXCLUDE USING gist`) on `(doctorId, tstzrange(startAt, endAt))` for active statuses, OR
- Transactional check + row-level lock on `(doctorId, date)` schedule “bucket”.

### Encounters / Visits
- `Encounter`:
  - `id`, `clinicId`, `branchId`, `doctorId`, `patientId`
  - `appointmentId?`
  - `visitedAt`, `chiefComplaint`, `notes`, `diagnosis`, `vitals(json)`, `followUpAt?`
  - `status` (DRAFT|SIGNED)

### Prescriptions (Hybrid)
- `MedicineCatalogItem` (optional initially): `id`, `clinicId`, `name`, `forms`, `strengths`
- `Prescription`:
  - `id`, `clinicId`, `branchId`, `doctorId`, `patientId`, `encounterId`
  - `items[]`: each item supports:
    - structured: `medicineCatalogItemId?`
    - free-text: `customName?`
    - `dosage`, `frequency`, `duration`, `instructions`
  - `shareToken?`, `pdfDocumentId?`, `createdAt`

### Billing & Payments (Hybrid)
- `ServiceCatalogItem`: `id`, `clinicId`, `name`, `defaultPrice`, `taxCode?`, `active`
- `Bill`:
  - `id`, `clinicId`, `branchId`, `patientId`, `encounterId?`, `appointmentId?`
  - `billNo` (unique per branch/year or clinic-wide; config-driven)
  - `currency`, `subtotal`, `discount`, `tax`, `total`, `status` (DRAFT|ISSUED|VOID)
  - `items[]`: supports catalog service or custom service name + price
  - `issuedAt`, `createdBy`
- `Payment`:
  - `id`, `clinicId`, `branchId`, `billId`
  - `method` (CASH|UPI|CARD|ONLINE|BANK_TRANSFER)
  - `amount`, `providerRef?`, `paidAt`, `receivedBy`

### Documents
- `Document`:
  - `id`, `clinicId`
  - `ownerType` (PATIENT|APPOINTMENT|ENCOUNTER|BILL|PRESCRIPTION)
  - `ownerId`
  - `mimeType`, `fileName`, `sizeBytes`, `storageKey`
  - `createdBy`, `createdAt`
  - `access` (INTERNAL_ONLY|SHAREABLE_WITH_TOKEN)
- `DocumentShare`:
  - `id`, `clinicId`, `documentId`
  - `token`, `expiresAt`, `maxViews?`, `revokedAt?`
  - `createdBy`

### Notifications
- `NotificationTemplate`: per clinic, per channel (SMS/WhatsApp)
- `NotificationJob`: scheduled reminder jobs
- `NotificationLog`: request/response, provider status, retries, correlation ids

### Inventory (Optional)
- `InventoryItem`: `id`, `clinicId`, `name`, `sku?`, `active`
- `InventoryBatch`: `id`, `itemId`, `batchNo`, `expiryAt`, `purchasePrice`, `sellingPrice`, `quantityOnHand`
- `StockMovement`: `id`, `clinicId`, `branchId`, `type` (IN|OUT|ADJUST), `refType` (BILL), `refId`, `qty`, `createdAt`

---

## API Design (Backend)

> Style recommendation: REST or GraphQL both work. The important part is consistent tenant scoping, idempotency for payments, and transactional scheduling/billing.

### Authentication & RBAC
- [ ] `POST /auth/login` (password/OTP)
- [ ] `GET /me` returns user, clinic, branches, permissions
- [ ] Middleware: `requireClinicContext`, `requirePermission("...")`

### Patients
- [ ] `POST /patients` create
- [ ] `GET /patients?query=` search (name/phone/MRN)
- [ ] `GET /patients/:id` profile + identifiers
- [ ] `GET /patients/:id/history` appointments + encounters + bills
- [ ] `POST /patients/:id/documents` upload/link

### Appointments
- [ ] `GET /doctors/:id/availability?from=&to=&branchId=`
- [ ] `POST /appointments` create (TIME or QUEUE)
- [ ] `PATCH /appointments/:id` reschedule/cancel
- [ ] `GET /appointments?date=&branchId=&doctorId=` daily list
- [ ] `POST /appointments/:id/checkin` (for queue/workflow)

### Encounters & Prescriptions
- [ ] `POST /encounters` start (optionally from appointment)
- [ ] `PATCH /encounters/:id` update notes/vitals
- [ ] `POST /encounters/:id/sign` finalize
- [ ] `POST /encounters/:id/prescriptions` create
- [ ] `GET /prescriptions/:id/pdf` generate/return
- [ ] `POST /prescriptions/:id/share` creates share token + sends link

### Billing & Payments
- [ ] `POST /bills` create draft/issued
- [ ] `PATCH /bills/:id` update items/discount (if draft)
- [ ] `POST /bills/:id/issue` finalize totals + billNo
- [ ] `POST /bills/:id/payments` add payment (idempotency key recommended)
- [ ] `GET /bills/:id/pdf` export

### Documents
- [ ] `POST /documents` upload (pre-signed url flow)
- [ ] `GET /documents/:id` metadata (requires access)
- [ ] `GET /documents/:id/download` signed download url
- [ ] `POST /documents/:id/share` create share token
- [ ] `GET /share/:token` public access (token + expiry + rate limiting)

### Configuration
- [ ] `GET /config` clinic settings
- [ ] `PATCH /config` update toggles/rules (admin only)
- [ ] `GET /catalog/services` and `POST /catalog/services`
- [ ] `GET /catalog/medicines` (optional)

### Notifications
- [ ] `POST /notifications/test` (admin)
- [ ] Background: reminder scheduler (e.g., 24h and 2h before)

---

## UI/UX Planning (Front Desk + Doctor)

### Navigation (recommended)
- Dashboard
- Patients
- Appointments (calendar + queue)
- Consultation (doctor view)
- Billing
- Documents
- Admin (users/roles, branches, settings, catalogs, templates)

### Key Workflows

**Patient registration**
- [ ] Fast entry (name + phone) with de-dupe suggestions
- [ ] Generate MRN/clinic unique id
- [ ] Attach documents (optional)

**Appointment booking**
- [ ] Select branch → doctor → date
- [ ] Choose TIME slot or QUEUE token
- [ ] Prevent conflict; show next available
- [ ] Send confirmation via SMS/WhatsApp (configurable)

**Consultation**
- [ ] Start encounter from appointment or walk-in
- [ ] Capture vitals/notes
- [ ] Create prescription (structured search + custom entry)
- [ ] Generate/share PDF
- [ ] Optionally start bill from encounter

**Billing**
- [ ] Select predefined services or add custom line items
- [ ] Apply discount (percent/fixed; rule-config)
- [ ] Collect payments (multi method, partial payments)
- [ ] Generate/share bill PDF

---

## Configuration & Rules Engine

### Clinic-level settings (examples)
- [ ] `modules.inventory.enabled` (boolean)
- [ ] `modules.patientPortal.enabled` (boolean, future)
- [ ] `appointments.mode` = `TIME` | `QUEUE` | `BOTH`
- [ ] `appointments.slotMinutesDefault`
- [ ] `billing.billNoFormat` (per-branch/per-clinic, fiscal-year reset)
- [ ] `billing.discount.maxPercent` (optional control)
- [ ] `notifications.channels.enabled` (SMS/WhatsApp)
- [ ] `notifications.reminders` (timings, templates)
- [ ] `locale.currency`, `locale.timezone`, `locale.phoneCountryCode`

**Implementation note:** Store settings as a typed schema (validated) and load into a per-request config object to avoid scattered feature-flag checks.

---

## Non-Functional Requirements (Implementation Tactics)

### Performance
- [ ] Add indexes: `(clinicId, phone)`, `(clinicId, normalizedName)`, `(clinicId, doctorId, startAt)`
- [ ] Pagination everywhere (patients, bills, documents)
- [ ] Cache clinic config (short TTL) + invalidation on update

### Reliability & Consistency
- [ ] Use DB transactions for: appointment booking, bill issue, payment posting, inventory deduction
- [ ] Outbox pattern or durable queue for notifications (avoid “sent but not recorded”)
- [ ] Idempotency keys for payment creation and provider callbacks

### Security
- [ ] RBAC enforcement at API layer + row-level tenant scoping
- [ ] Encrypt secrets; never store raw provider creds in DB without encryption
- [ ] Secure documents: signed URLs, tokenized shares, expiry, rate limiting, audit
- [ ] PII logging policy (mask phone/email in logs)

### Scalability
- [ ] Tenant partitioning strategy (by `clinicId` indexing; optional DB sharding later)
- [ ] Async jobs for heavy tasks (PDF generation, reminders)

### Usability
- [ ] Keyboard-first booking flows
- [ ] Patient quick search from any screen
- [ ] Minimal clicks for “register → book → consult → prescribe → bill”

---

## Detailed Task Breakdown (Execution Checklist)

## Task A: Project skeleton + infra
- [ ] Choose stack (recommended: Postgres + backend framework + web frontend)
- [ ] Setup DB migrations + seeders
- [ ] Setup object storage integration (S3/MinIO)
- [ ] Setup queue + worker process
- [ ] Setup environment config + secrets management

## Task B: Tenancy + RBAC + audit logs
- [ ] Implement `Clinic`, `Branch`, `User`, `Role`, `Permission`
- [ ] Add middleware enforcing `clinicId` scoping
- [ ] Add audit log writes for create/update/delete on core entities

## Task C: Patients + documents
- [ ] Patient CRUD + de-dupe heuristics (same phone + similar name)
- [ ] Patient history endpoints (appointments/encounters/bills)
- [ ] Document upload + linking + access checks

## Task D: Appointments (TIME + QUEUE)
- [ ] Doctor availability model (recurring + overrides)
- [ ] Scheduling endpoints + UI calendar views
- [ ] Implement double-booking prevention
- [ ] Queue tokens per doctor/day/branch (configurable reset rules)

## Task E: Encounters + prescriptions
- [ ] Encounter workflow (draft/sign)
- [ ] Prescription hybrid entry UI
- [ ] PDF generation (server-side) + store as `Document`
- [ ] Share link (token) + WhatsApp/SMS send

## Task F: Billing + payments
- [ ] Service catalog (predefined)
- [ ] Bill calculation engine (subtotal/discount/tax/total)
- [ ] Payments (partial/multiple)
- [ ] Bill PDF + sharing

## Task G: Notifications & reminders
- [ ] Provider abstraction + config per clinic
- [ ] Reminder scheduling jobs (24h/2h configurable)
- [ ] Retries + delivery logs + admin troubleshooting view

## Task H: Inventory (optional)
- [ ] Inventory enabled toggle
- [ ] Stock/batch/expiry tables + low stock alerts
- [ ] Deduct inventory on billing line items mapped to items

---

## Testing & Verification Plan (Practical)

### Automated tests (minimum recommended)
- [ ] Unit tests: billing total calculations, discount rules, idempotency
- [ ] Unit/integration tests: appointment conflict prevention
- [ ] API tests: RBAC + tenant isolation (cannot access other clinic/branch data)
- [ ] Document access tests: share token expiry + access restrictions
- [ ] Notification retry logic tests (provider failures)

### Manual verification checklist
- [ ] Create clinic + two branches; create users with different roles
- [ ] Register patient; attach document; verify access restrictions per role
- [ ] Book TIME appointment; attempt double-book; ensure rejection
- [ ] Create QUEUE appointment; check ordering and status changes
- [ ] Create encounter + prescription (catalog + custom); generate/share PDF
- [ ] Create bill with multiple services; apply discount; add split payments
- [ ] Confirm bill PDF export and access control
- [ ] Enable reminders; verify scheduled messages and delivery logs
- [ ] (If inventory enabled) bill deducts stock; low stock alert triggers

---

## Risks & Mitigations
- **Scheduling correctness:** must be enforced at DB level; rely on transactions/constraints.
- **Provider delivery variability:** treat notifications as async with retries + observability.
- **PII/security:** implement least privilege RBAC and secure document flows early.
- **Hybrid data quality:** maintain both structured catalog and free-text; add normalization later.
- **Multi-country/timezone bugs:** store all timestamps in UTC; render using clinic/user timezone.

---

## Deliverables (What “done” means for Phase 1)
- **Clinic admin** can configure branches, users/roles, reminders, catalogs.
- **Front desk** can register/search patients, book/reschedule/cancel appointments (TIME/QUEUE), and collect payments.
- **Doctor** can run consultations, create prescriptions quickly (structured/custom), and share PDFs.
- **Billing** supports itemized bills with discounts, multiple payment methods, and PDF exports.
- **Documents** are securely stored and accessible only by authorized users or via expiring share links.

