# On-call

## Schedule

Primary + backup, weekly rotation, Mon 09:00 → Mon 09:00 (clinic
timezone). One engineer must always be reachable; the backup picks up
when primary doesn't acknowledge a page within 10 minutes.

## What gets you paged

| Trigger                                           | Severity | How to silence |
|---------------------------------------------------|----------|----------------|
| `/health` returns 5xx for >2 min                  | Sev-1    | Restore health |
| Backend p95 latency >2s for >5 min                | Sev-2    | Investigate    |
| Booking-overlap conflict rate >1% sustained 10 min| Sev-2    | Investigate    |
| Reminder cron failed to fire for >2 hours         | Sev-3    | Office hours   |
| Bill-counter gap >100 between consecutive numbers | Sev-2    | Investigate    |
| Disk usage >85% on Mongo nodes                    | Sev-3    | Office hours   |
| MinIO bucket >85% of quota                        | Sev-3    | Office hours   |
| Audit log writes failing                          | Sev-2    | Investigate    |

## Setup checklist for a new on-call

- [ ] PagerDuty (or equivalent) installed on phone, push notifications enabled.
- [ ] Read every doc in `docs/ops/` once.
- [ ] Run a deploy + rollback in staging, hands-on.
- [ ] Run a Mongo failover drill in staging (kill the primary, watch
      `rs.status()` elect a new one, watch the app survive).
- [ ] VPN access to production, tested.
- [ ] Access to the secret manager.
- [ ] Slack channels: `#incidents`, `#oncall`, `#deploys`.
- [ ] Status page admin access.
- [ ] Phone numbers for: customer success lead, legal lead, hosting
      provider's emergency line.

## Daily check (5 minutes)

- [ ] Skim `#deploys` for anything shipped in the last 24h.
- [ ] Check the dashboard:
      - error rate (target <0.1%)
      - p95 latency
      - reminder cron last-firing time
      - audit-log write success rate
      - Mongo replication lag (target <2s)
- [ ] Walk the on-coming person through anything noteworthy.

## What to do during a page

See `docs/ops/incident.md`. Short version:

1. Acknowledge within 5 min.
2. Open the incident channel.
3. Stop the bleeding (rollback / disable feature) before debugging.
4. Update the channel every 15 min.
5. Post resolution + schedule a postmortem.
