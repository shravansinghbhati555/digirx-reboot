# Offline module

Everything the offline-first work owns on the backend. See
`docs/offline-first-implementation-plan.md` for the phasing; this file is the
architectural boundary.

## The rule

**This module owns offline policy. Feature modules declare participation in
one line — they never implement offline behaviour themselves.**

Concretely, for a create path to accept a client-minted `_id`:

1. Its create-DTO extends `ClientIdDto` (one `extends`, one import).
2. Its service spreads `...clientIdFields(dto._id)` into the `Model.create(...)`.

That's the whole contract. Validation, error mapping, and the wire format of
the conflict response live here and change in one place.

## Why the touch points cannot be zero

A client-supplied `_id` is a property of an individual create path, so
something has to say "this create honours it". The alternatives are worse:

- A **Mongoose plugin** applied to every schema would also capture *internal*
  creates that happen during a request. A patient create also writes a
  `PatientIdentifier` row for the MRN — that row would try to claim the
  patient's `_id` and collide. Scoping the plugin per collection re-introduces
  the same per-entity declaration, only further from the code it affects.
- **AsyncLocalStorage** carrying the id implicitly has the same problem plus
  invisible control flow.

One explicit spread per create site is the smallest honest footprint. It is
also greppable, which matters when debugging a replay.

## Opting out is the default

The global `ValidationPipe` runs with `forbidNonWhitelisted: true`. A DTO that
does *not* extend `ClientIdDto` rejects a body carrying `_id` with a 400. So
entities that cannot be created offline refuse client ids automatically —
nothing to remember, nothing to configure.

## Layout

```
offline/
├── client-id.util.ts                   # clientIdFields, resolveClientId, isDuplicateIdError
├── dto/client-id.dto.ts                # ClientIdDto — the opt-in mixin
├── filters/client-id-conflict.filter.ts # global: duplicate _id -> 409 CLIENT_ID_EXISTS
├── offline.module.ts                   # registers the filter as APP_FILTER
└── client-id.spec.ts
```

## Participating entities

Patient, appointment, encounter, prescription, bill — the five that Phase 0
allows a single offline device to create.

Payments are deliberately **not** here: they already replay safely via
`idempotencyKey` and its partial unique index on
`(clinicId, billId, idempotencyKey)`. Adding a second replay mechanism would
give two code paths a say in the same decision.

## Conflict semantics

A duplicate `_id` returns **409** with `code: "CLIENT_ID_EXISTS"`.

In practice this is never a real collision — ObjectIds do not realistically
clash. It is the write queue replaying a create that already landed, so the
replay engine keys on `code` to mark that entry done rather than parking it in
the failure surface. We still reject rather than silently returning the
existing row, so a buggy client cannot adopt another record by guessing its id.

The filter only fires when the request body actually carried an `_id`. A
duplicate `_id` without one is a genuine server-side collision and keeps its
original handling.

## Still to land here

- **A4** device registry + PIN unlock
- **C1** number leases (MRN, prescription, bill) — the lease schema, issue and
  refill endpoints, and the `issueBill` path that accepts a pre-minted number
- **Phase 3+** outbox and sync endpoints
