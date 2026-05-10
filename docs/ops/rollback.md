# Rollback

A rollback should take **<5 minutes**. If it's taking longer, you're
debugging instead of rolling back — stop, page the next on-call, and
revert.

## When to roll back

- `/health` returns 503 for >2 minutes after a deploy.
- Error rate >1% sustained over 5 minutes.
- A schema migration corrupted data (rare but high-impact).
- A new release silently changes behaviour (e.g. bills issued under the
  wrong fiscal year, refunds counting twice).

## How

### Application-only rollback (no schema changes)

```bash
# Re-tag and roll. Replace v1.3.7 with the last known-good tag.
BACKEND_TAG=v1.3.7 FRONTEND_TAG=v1.3.7 \
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

`/health` should return green within ~30s. Verify the failing
behaviour from the user report no longer reproduces.

### Schema migration rollback

Migrations live in `backend/migrations/` and are run by `migrate-mongo`.
Each migration has a `down()` that reverses it. **Down migrations are
NOT auto-run** — invoke explicitly:

```bash
docker run --rm --env-file .env.prod digirx/backend:v1.3.7 \
  pnpm migrate:down
```

Then redeploy the previous app version (above).

If `down()` is a destructive operation (would delete data the new code
relies on), prefer **fix-forward**: cherry-pick a corrective migration
on top, ship a new tag.

## Data-corruption case

If a release wrote bad data (not just buggy code):

1. Don't redeploy yet.
2. **Restore the latest backup to a side instance**. See
   `docs/ops/restore.md`.
3. Compare the side instance's authoritative records against the live
   primary for the affected window.
4. Either:
   - Cherry-pick the bad rows back from the side instance (safer), or
   - Restore the live primary from backup (down for the restore window).
5. Roll back the application as above.
6. File a postmortem — `docs/ops/incident.md`.

## After rollback

- [ ] On-call posts in `#incidents` confirming rollback complete.
- [ ] Open a tracking issue for the underlying bug, tagged `regression`.
- [ ] Add a regression test that would have caught the bug.
- [ ] Ship the fix-forward release within 24h or schedule a postmortem.
