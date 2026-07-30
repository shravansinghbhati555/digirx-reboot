# Security policy

DiziRx handles patient health information (PHI). Vulnerabilities affecting
data confidentiality, integrity, or availability are treated as severity-1
issues and fixed ahead of feature work.

## Reporting a vulnerability

**Please do not file a public GitHub issue for security findings.**

Email: `security@example.com` (replace with your real address)

What to include:

- A clear description of the issue and the affected endpoint / file path.
- Reproduction steps. A `curl` snippet or a small failing test is ideal.
- The version / git SHA you reproduced against.
- Your assessment of impact (read access? cross-tenant leak? RCE?).

Acknowledgement: within 2 business days.
First triage: within 5 business days, including a CVSS-style severity call.
Coordinated disclosure: we'll agree a disclosure window with you when a fix
is ready and a security release is cut.

We don't yet run a paid bug bounty. We do publicly credit reporters in the
release notes once the fix has shipped, unless you ask us not to.

## Supported versions

| Version | Status |
|---------|--------|
| `main`  | ✅ supported — security fixes shipped to the latest tag |
| Older tags | ❌ no backports — upgrade to the latest tag |

## What's in scope

- Tenant isolation: any way to read or mutate a record outside your `clinicId`.
- Authentication / authorisation: permission bypasses, JWT forgery, refresh-cookie theft.
- Data exposure: PHI leaks via logs, error messages, presigned URLs, share tokens.
- Injection: NoSQL injection in Mongo aggregations, prototype pollution.
- Idempotency / financial integrity: double-billing, double-refund, void+pay races.
- Denial of service amplifiers: unbounded queries, BullMQ queue floods.

## What's out of scope

- Reports run against a deployment you control (please don't load-test prod).
- Self-DoS via legitimate features (e.g. uploading a 100MB file).
- Public-facing share-token endpoints behaving as designed (rate-limited, expiring, revocable).

## Built-in mitigations (current state)

- **Tenant isolation**: every Mongoose query takes `clinicId` as the first
  filter; the `ClinicContextMiddleware` populates it from the JWT before
  the controller runs. Cross-tenant `GET` returns 404 (no existence
  oracle); see `test/tenant-isolation.e2e-spec.ts`.
- **JWT**: short-lived access token + bcrypt-hashed rotating refresh
  token in an httpOnly Secure SameSite=Strict cookie (production).
  `validateEnv` rejects boot if the dev secret defaults are still in place.
- **PII redaction**: audit-log writes pass through `redactPII()` which
  strips passwords / tokens / phones / emails recursively before persist.
- **Rate limiting**: 120 req/min per IP globally; 10 req/min on
  `/auth/login`, `/auth/refresh`, `/share/*`, and unauthenticated
  clinic-discovery endpoints.
- **Idempotency**: payment + refund POSTs require a client-generated UUID
  key; replays return the original record with `X-Idempotent-Replay: true`.
- **Public share tokens**: 24-byte random hex, optional `expiresAt`,
  optional `maxViews` (atomic `$inc + $lt` guard), revocable.
- **TTL retention**: audit + access + per-document logs all carry
  `expiresAt` per clinic setting (`logs.retentionDays`, default 365).
- **Helmet headers**: HSTS (prod), X-Content-Type-Options, X-Frame-Options
  DENY, Referrer-Policy. CSP enforced at the FE nginx layer.

See `docs/ops/incident.md` for the on-call response procedure.
