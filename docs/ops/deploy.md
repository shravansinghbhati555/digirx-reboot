# Deploy

Production deploys are tag-driven. `main` is auto-deployed to staging on
every merge; production rollouts happen on git tag.

## Pre-flight

- [ ] CI is green on the commit you're tagging.
- [ ] `pnpm audit` (both `backend/` + `frontend/`) reports no high/critical findings.
- [ ] Migrations: `cd backend && pnpm migrate:status` shows nothing pending
      OR you've planned the migration window with the on-call.
- [ ] Secrets: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `MONGO_ROOT_PASSWORD`,
      `REDIS_PASSWORD`, `MINIO_KMS_SECRET_KEY` all live in the secret manager,
      not in git.
- [ ] Backups: `mongodump` job ran in the last 24h (`docs/ops/restore.md`).

## Cut a release

```bash
# from a clean main
git tag -a v1.4.0 -m "1.4.0 — billing v2"
git push origin v1.4.0
```

The `release.yml` workflow (TODO — not yet wired) will build images, push to
the registry, run any pending migrations, and roll the backend behind the
load balancer.

## Roll out (manual fallback)

If the workflow can't run (registry outage etc.):

```bash
# 1. Build images.
docker build -t digirx/backend:v1.4.0 ./backend
docker build -t digirx/frontend:v1.4.0 ./frontend \
  --build-arg VITE_API_BASE_URL=https://api.example.com

# 2. Push.
docker push digirx/backend:v1.4.0
docker push digirx/frontend:v1.4.0

# 3. Apply pending migrations (idempotent — safe to re-run).
docker run --rm --env-file .env.prod digirx/backend:v1.4.0 \
  pnpm migrate:up

# 4. Roll the running stack.
BACKEND_TAG=v1.4.0 FRONTEND_TAG=v1.4.0 \
  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## Verify

After the rollout completes:

```bash
# 1. /health is green.
curl https://api.example.com/health
# → { ok: true, deps: { mongo: ok, redis: ok, s3: ok } }

# 2. Loginable.
curl -X POST https://api.example.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ "clinicId": "...", "email": "smoke@...", "password": "..." }'

# 3. Frontend renders.
curl -I https://app.example.com/
# → 200, with HSTS + CSP headers in the response.

# 4. Spot-check a critical write — issue + pay a test bill in staging.
```

If any verify step fails: `docs/ops/rollback.md`.
