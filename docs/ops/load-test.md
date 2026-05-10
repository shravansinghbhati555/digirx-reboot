# Load test + chaos drill

We run two drills monthly: a **load test** (200 concurrent bookings) and
a **Mongo primary kill drill**. Both run against staging; never prod.

## Load test — 200 concurrent bookings

The booking-overlap path is the hottest correctness path in the app.
Verify under contention that:

- No two appointments end up at the same time slot.
- Queue counters never produce duplicate numbers.
- The transactional fallback for standalone Mongo doesn't fire (replica
  set is the deployment target).

Tool: [`k6`](https://k6.io). Install once: `winget install k6` or
`brew install k6`.

```js
// scripts/load-booking.js
import http from 'k6/http';
import { check } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

export const options = {
  scenarios: {
    burst: {
      executor: 'shared-iterations',
      vus: 200,
      iterations: 200,
      maxDuration: '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const API = __ENV.API || 'https://staging-api.example.com';
const TOKEN = __ENV.TOKEN; // staging admin JWT
const DOCTOR = __ENV.DOCTOR;
const BRANCH = __ENV.BRANCH;
const PATIENT = __ENV.PATIENT;

export default function () {
  // Each VU targets the same minute → maximum contention.
  const startAt = '2026-06-01T10:00:00Z';
  const endAt = '2026-06-01T10:30:00Z';
  const res = http.post(
    `${API}/appointments`,
    JSON.stringify({
      branchId: BRANCH,
      doctorId: DOCTOR,
      patientId: PATIENT,
      type: 'TIME',
      startAt,
      endAt,
    }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` } },
  );
  check(res, {
    'is 201 or 409': (r) => r.status === 201 || r.status === 409,
  });
}
```

Run:

```bash
k6 run scripts/load-booking.js -e API=https://staging-api.example.com -e TOKEN=... -e DOCTOR=... -e BRANCH=... -e PATIENT=...
```

Pass criteria:

- **Exactly 1** request returns 201 (the winner).
- **199** return 409 (overlap conflict).
- p95 latency of the 409s <500ms.
- No 5xx anywhere.

If a second 201 appears: stop everything, this is a Sev-1. The booking
transaction guard or replica-set is broken.

## Mongo primary kill drill

Verifies that when the Mongo primary dies, the replica set elects a new
primary within ~10s and the app continues to serve writes (with brief
elevated latency during the election).

```bash
# 1. Note the current primary.
docker compose -f docker-compose.prod.yml exec mongo-primary \
  mongosh --quiet --eval 'rs.isMaster().primary'

# 2. Start a synthetic write load (e.g. autocannon hitting POST /appointments
#    in a loop) so the impact is visible.
autocannon -d 60 -c 5 -m POST -H "Authorization: Bearer $TOKEN" \
  -b '{"branchId":"...","doctorId":"...","patientId":"...","type":"QUEUE","queueDate":"2026-06-01"}' \
  https://staging-api.example.com/appointments &

# 3. Kill the primary.
docker compose -f docker-compose.prod.yml stop mongo-primary

# 4. Watch the election.
docker compose -f docker-compose.prod.yml exec mongo-secondary \
  mongosh --quiet --eval 'rs.status().members'

# 5. After ~10s, the new primary is up. The autocannon run should show
#    a brief spike in 5xx errors, then recovery.

# 6. Bring the old primary back as a secondary.
docker compose -f docker-compose.prod.yml start mongo-primary
```

Pass criteria:

- New primary elected within 15 seconds.
- 5xx error rate spikes briefly (during the election) then returns to baseline.
- No data loss — the replica that became primary had all the writes.
- App's `/health` returns to ok within 30 seconds total.

## Reporting

After each drill:

- Append a row to `docs/ops/drill-log.md` with: date, who, pass/fail, notes.
- File issues for any pass-criteria miss.
- If the drill caused a real outage (drilling against the wrong env, etc.),
  treat it as a real incident — `docs/ops/incident.md`.
