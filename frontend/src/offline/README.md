# Offline layer (frontend)

Mirrors `backend/src/modules/offline/`. See
`docs/offline-first-implementation-plan.md` for the phasing.

## The rule

**This folder owns offline policy. `api.ts` and the screens import from
`./offline`, and know nothing about how it works.**

`api.ts` is the only writer of connectivity state — it reports what it
observed on each request. Everything else reads.

## The distinction that matters

A request can fail two ways that look identical at the call site and mean
opposite things:

| Failure | Meaning | Correct response |
|---|---|---|
| `fetch` rejects | Never reached the server | Keep the session. Queue the work. |
| `401` + refused refresh | Server says the session is dead | Clear context, go to /login |

Before A2 these were merged: `refreshAccessToken` returned `null` for both,
and both ended the session. On a rural connection that logged the user out
every time the signal dropped — and once the write queue lands, it would take
a morning of consultations with it.

`RefreshResult` in `api.ts` is now three cases (`ok` / `unauthorized` /
`offline`) precisely so only `unauthorized` can end a session.

## Reading connectivity

```ts
import { isOnline, subscribeConnectivity, isOfflineError } from '../offline';

const stop = subscribeConnectivity((online) => { /* … */ });
```

`subscribeConnectivity` fires only on transitions, not per request.

Catch sites that want to treat "offline" differently from a real error use
`isOfflineError(err)` rather than matching on message text.

## Why `navigator.onLine` is not the source of truth

`navigator.onLine === true` only means a network interface exists. On a
clinic LAN with no ISP that is exactly the supported situation — the server is
reachable, the internet is not. So the browser's signal is a hint; an observed
request outcome is the truth. We do trust `false`, since a dropped interface
is unambiguous.

## The offline grace window (A3)

A2 made an unreachable server stop ending sessions. But "never expires while
offline" is not acceptable either — a device holding a full patient database
would keep working forever with nobody able to revoke it.

So an offline session gets a bounded window, measured from the last request
the server actually accepted:

| Status | When | Reads | Writes |
|---|---|---|---|
| `fresh` | Online | ✓ | ✓ |
| `grace` | Offline, inside the window | ✓ | ✓ |
| `expiring` | Offline, within `OFFLINE_WARN_HOURS` of the end | ✓ | ✓ + warn |
| `expired` | Offline, past the window | ✗ | ✗ |

Defaults: **72h** grace, **8h** warning. Both configurable via
`VITE_OFFLINE_GRACE_HOURS` / `VITE_OFFLINE_WARN_HOURS`. The 72h figure is a
placeholder until open question 2 in the plan (how long a realistic outage
runs) is answered.

### What expiry does *not* do

It does not clear the context, and it does not discard queued work. A locked
device still holds everything it captured; reconnecting restores access.
Destroying a morning of consultations because a token aged out would be far
worse than refusing to start new ones.

### Two stamps, not one

- `sessionVerifiedAt` — any accepted request. Proves the session is alive.
- `permissionsVerifiedAt` — a successful `/me`. Only this proves the cached
  `permissions` array is current. When it ages past the grace window,
  `permissionsStale` goes true (advisory, not blocking).

A 401 deliberately does **not** stamp: it proves the opposite.

### The deadlock we avoided

`api.ts` refuses **mutations** when expired, but still lets reads go out. A
blanket block would deadlock — no request means no re-stamp, means no
recovery, until the browser happened to fire an `online` event. A successful
read is how a locked device unlocks itself.

`OfflineSessionExpiredError` is separate from `OfflineError` because the
remedy differs: reconnect to re-verify, versus just retry.

## Device identity and the PIN (A4)

### Identity

`device.ts` mints a UUID once and keeps it under its **own** storage key, not
in `DevContext`. `clearContext()` wipes the session on logout, and a device
that forgot its identity would orphan its outstanding number leases and break
attribution for anything still sitting in the queue. The identity outlives the
session; only an explicit "unregister this device" clears it.

It rides on every request as `x-device-id`, lands in `RequestContext.deviceId`,
and is stamped onto `AuditLog.deviceId` — so a write entered offline is still
traceable to where it was made once it finally syncs. The header is validated
against a strict pattern server-side and dropped if it does not match: it
identifies, it never authorizes.

### The PIN is a UI gate, not encryption

**Do not tell a clinic their data is encrypted because a PIN is set.**

Cached clinical data lives in localStorage and (from B1) IndexedDB, both
readable by anyone who can open DevTools on an unlocked OS account. A PIN
prompt does not change that. What it does stop is the realistic threat: a
tablet left on a reception desk and picked up by the next person in the room.

Real at-rest protection requires either OS/disk encryption on the device — the
practical answer, and mandatory from Phase 2 when a clinic box holds the whole
database — or encrypting the cached store under a PIN-derived key. `deriveKey`
is exported so B1 can do the latter without inventing a second secret.

What *is* done properly:

- **PBKDF2-HMAC-SHA256, 310k iterations, 16-byte random salt.** A 6-digit PIN
  has almost no entropy, so the KDF is the only thing between a leaked hash
  and a trivial offline brute force.
- **Minimum 6 characters.** Four digits is 10k combinations — not enough even
  with a slow KDF.
- **Constant-time comparison**, so a timing side channel cannot leak a prefix.
- **Exponential backoff** after 5 failures: 30s doubling to a 15-minute cap.

### Failed attempts never wipe data

The device may be holding a morning of unsynced consultations. Destroying them
because someone fat-fingered a PIN would be a far worse outcome than a delay —
the same principle as A3's expiry, which also preserves the queue.

### Biometric

Not implemented. WebAuthn platform authenticators are the route, and the PIN
surface is shaped so unlock can gain a second method without changing callers.

## Layout

```
offline/
├── connectivity.ts   # A2 — offline vs unauthorized, connectivity state
├── session.ts        # A3 — grace window state machine (pure)
├── session-store.ts  # A3 — persistence of the stamps
├── device.ts         # A4 — stable device identity
├── pin.ts            # A4 — local PIN lock + idle auto-lock
├── index.ts          # public surface
└── README.md
```

## Still to land here

- **A1 (client)** `ids.ts` — mint ObjectIds in the browser, matching the
  backend's `ClientIdDto` contract
- **A4 (UI)** the unlock screen and lock-on-hide wiring — `pin.ts` exposes the
  state, but nothing renders it yet (that is E1)
- **B1/B2** `db.ts` — IndexedDB stores and the working-set pull
- **B4/B5** `queue.ts` and `replay.ts` — the durable write queue and its
  replay engine, which keys on the backend's `CLIENT_ID_EXISTS` code to tell
  an already-applied create from a real failure
- **C2** `leases.ts` — number leases for MRN, prescription and bill

## Testing gap

The frontend has no unit-test runner — only Playwright e2e
(`frontend/package.json`). That is survivable for UI work but a real risk for
the write queue and replay engine in B4/B5, where the logic is pure and the
failure modes are subtle. Worth adding Vitest before that work starts.
