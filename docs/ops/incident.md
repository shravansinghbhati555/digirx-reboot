# Incident response

## Severity ladder

| Sev | Definition                                       | Page on-call? | Customer comms |
|-----|--------------------------------------------------|---------------|----------------|
| 1   | Total outage OR PHI exposure OR financial loss   | Immediately   | <30 min        |
| 2   | Partial outage; one feature down for >15 min     | Immediately   | <2 h           |
| 3   | Degraded performance; non-critical feature broken| Business hrs  | Status page    |
| 4   | Cosmetic / single-clinic issue                   | Next sprint   | None           |

PHI exposure is **always** Sev-1 even if it's "only" one record.

## Roles

- **Incident commander (IC)** — runs the response. Not the technical
  responder; their job is to delegate, track, and protect comms.
- **Tech lead** — debugs and ships the fix.
- **Comms lead** — talks to customers + internal stakeholders.

For Sev-3/4, the same person can wear all three hats.

## Response template

```
Title: [SEV-X] One-line description
Started: 2026-05-08T14:23Z
IC: @alice
Tech: @bob
Status: investigating | mitigating | monitoring | resolved

## Symptom
What's broken from the user's perspective.

## Suspected cause
Best current hypothesis. Update as the investigation progresses.

## Customer impact
- [ ] Which clinics / users affected
- [ ] How many requests / actions failed
- [ ] Any data loss or corruption?

## Actions
- 14:25 @bob: pulled error rate dashboard, billing endpoint at 12% 5xx
- 14:28 @bob: rolled bill-numbering back to v1.3.6 — error rate dropping
- 14:32 @alice: drafted customer comm
- ...

## Resolution
What fixed it. Link to the corrective PR.

## Followups
- [ ] Postmortem doc due 2026-05-15
- [ ] Add regression test (link to issue)
- [ ] Detection improvement (link to issue)
```

## During an incident

1. **Acknowledge the page** within 5 minutes. Open the incident channel.
2. **Stop the bleeding before debugging.** Roll back; pause the failing
   queue; disable the broken feature flag. Root-causing comes after the
   site is stable.
3. **Communicate every 15 minutes** to the incident channel even if
   nothing has changed. "Still investigating, no new info" is more
   useful than silence.
4. **Don't make assumptions about data integrity** — pull a backup
   snapshot if a write path was affected.
5. **One change at a time.** If you toggle 3 things at once and the
   metric recovers, you don't know which one fixed it.

## After resolution

- Status: `resolved` in the incident channel + post-mortem scheduled
  within 5 business days.
- The post-mortem is **blameless** — the goal is "what process let this
  happen?" not "who did this?".
- Tracking issues for every followup, owned and dated.
- A regression test that would have caught the bug.
- If the incident exposed a missing detection, the post-mortem must
  include the specific dashboard panel / alert rule that's being added.

## Sev-1 specifics — PHI exposure

In addition to the above:

1. **Within 1 hour**: containment confirmed (the leak is no longer
   reachable). Document exactly which records were exposed and to
   whom.
2. **Within 4 hours**: legal + compliance notified. They drive the
   external disclosure timeline.
3. **Within 72 hours** (HIPAA / regional equivalent): regulatory
   notification filed if required.
4. The post-mortem must include a row-level export of the affected PHI
   (`docs/ops/dsr.md` covers the export format) so legal can audit.
