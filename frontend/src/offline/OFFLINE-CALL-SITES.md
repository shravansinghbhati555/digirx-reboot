# Offline behaviour, per write

Every mutating API call in the UI, and what it does without a connection.
Written because converting call sites one at a time as each failure was hit
meant the clinical flow kept dead-ending at the next unconverted button.

Three possible behaviours:

- **Queue** — saved locally, replayed in order on reconnect. Uses
  `apiPostQueued` / `apiPatchQueued`.
- **Degrade** — the action is hidden or refused offline, with a reason.
- **Online-only** — fails loudly. Correct for anything that cannot be made
  meaningful without the server.

## The clinical flow (must work offline end to end)

| Action | Endpoint | Behaviour |
|---|---|---|
| Register patient | `POST /patients` | **Queue** + MRN from lease |
| Book appointment | `POST /appointments` | **Queue** + local queue token |
| Check in | `POST /appointments/:id/checkin` | **Queue** + optimistic `CHECKED_IN` |
| Triage / vitals | `PATCH /encounters/:id` | **Queue** |
| Start consultation | `POST /encounters` | **Queue** (client-minted `_id`) |
| Save draft | `PATCH /encounters/:id` | **Queue** |
| Save prescription | `PATCH /encounters/:id/prescriptions` | **Queue** |
| Sign | `POST /encounters/:id/sign` | **Queue** + prescription number from lease + optimistic `SIGNED` |
| Create bill | `POST /bills` | **Queue** |
| Issue bill | `POST /bills/:id/issue` | **Queue** + bill number from lease. Refused if no lease — an unnumbered bill cannot be receipted. |
| Take payment | `POST /bills/:id/payments` | **Queue**, cash only. Already idempotent via `idempotencyKey`. |

## Degraded offline

| Action | Why |
|---|---|
| Non-cash payment | Needs a gateway or a reconciliation the device cannot perform. Method picker is cash-only offline. |
| Payment at booking | The auto-issued bill is created server-side, so there is no bill to pay against yet. Collected from Billing after sync. |
| Face enrol / recognise | Embedding happens in the `face-svc` sidecar. Degrades to manual search. |
| Document upload | Presigned PUT goes browser → S3. Could be queued as a blob later; not today. |
| Duplicate patient detection | A server-side query. A double registration can only be caught on sync. |

## Online-only (fails loudly, deliberately)

Void bill, credit notes, refunds, share links (bill / prescription), all of
Settings, Users, Roles, Inventory, Pharmacy, Documents, Notifications,
Platform, Leads, Profile, and login/logout.

These are either administrative — nobody configures roles during an outage —
or they need the server to compute something (a share token, a refund against
a bill that has not synced). Queueing them would add risk with no clinical
benefit.

## Rules for adding a write

1. **In the clinical flow? Queue it.** Anything a doctor or front desk does
   between a patient arriving and leaving.
2. **Does the server compute the result?** Then pass `optimistic` so the
   cached record reflects it. Queueing the cause is not enough — check-in
   queued fine but left the appointment reading `BOOKED`, which hid "Start
   consultation" and dead-ended the flow.
3. **Does it need a sequence number?** Draw it inside `enrichOnQueue`, never
   before — otherwise a successful online call burns a leased number too.
   Send the raw `seq`; the server renders the final string.
4. **Otherwise leave it online-only** and make sure the failure is legible.

## Known gaps

- **Queue tokens are not leased.** They are derived from the local cache and
  honoured by the server, which is only safe because Phase 0 is
  single-writer. Phase 2 must replace this with a lease. The unique queue
  index is the backstop.
- **No cash reconciliation view** (C6) — offline cash is recorded but there is
  no day-end total to check the drawer against.
- **No fiscal-year handling for bill leases** (C7) — a block leased in March
  and used in April belongs to the wrong year.
- **Failed-replay surface** (E3) is not built. A permanently failed write
  halts the queue and is only visible as a count in the banner.
