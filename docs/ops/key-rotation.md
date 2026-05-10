# Key rotation

Rotation cadence:

| Secret                    | Frequency  | Triggered by              |
|---------------------------|------------|---------------------------|
| JWT_ACCESS_SECRET         | 90 days    | scheduled                 |
| JWT_REFRESH_SECRET        | 180 days   | scheduled                 |
| MINIO_KMS_SECRET_KEY      | annual     | scheduled                 |
| Twilio auth token         | 180 days   | scheduled                 |
| MongoDB / Redis passwords | annual     | scheduled                 |
| Anything                  | immediately | suspected leak            |

## JWT_ACCESS_SECRET

Access tokens are short-lived (8h default). A rotation that is *not* a
breach response simply replaces the secret; users with a token signed
with the old secret will fail their next request, hit the FE's
auto-refresh path, mint a new access token using their refresh cookie,
and continue. Worst-case user impact: one extra round-trip.

```bash
# 1. Generate.
NEW_ACCESS=$(openssl rand -base64 64)

# 2. Store in the secret manager (replace `vault kv put` with your tool).
vault kv put secret/digirx/prod JWT_ACCESS_SECRET="$NEW_ACCESS"

# 3. Roll the backend deployment so it picks up the new env.
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend

# 4. Verify a fresh login signs and verifies cleanly.
curl -X POST https://api.example.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```

## JWT_REFRESH_SECRET

Rotating the refresh secret invalidates **every active refresh cookie**.
Every signed-in user will be force-logged-out on their next refresh
attempt. Schedule for off-hours (clinic timezone) and notify support.

The bcrypt-hashed `refreshTokenHash` stored in `sessions` does not
depend on the refresh secret directly — it's the JWT signing of the
refresh-cookie payload that breaks. Existing sessions remain in the DB
but become unverifiable, so their next `/auth/refresh` returns 401 and
the FE redirects to login.

```bash
NEW_REFRESH=$(openssl rand -base64 64)
vault kv put secret/digirx/prod JWT_REFRESH_SECRET="$NEW_REFRESH"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend
```

After rotation, optionally revoke the now-stale `sessions` rows:

```bash
docker compose exec mongo-primary mongosh \
  --eval 'db.sessions.updateMany({revokedAt:null}, {$set:{revokedAt:new Date()}})'
```

## MINIO_KMS_SECRET_KEY

MinIO uses this as the master key for SSE-S3-encrypted objects. **Do
not rotate without a re-encrypt plan**: existing objects encrypted with
the old key can't be read after the rotation.

```bash
# 1. Generate the new key, keep the old one available.
NEW_KMS=$(openssl rand -base64 32)

# 2. Run a re-encrypt over every object (this can take hours for a
#    large bucket — schedule a maintenance window).
mc admin kms key rotate alias/digirx digirx-master "$NEW_KMS"

# 3. Once the rotation completes, update the env and roll.
vault kv put secret/digirx/prod MINIO_KMS_SECRET_KEY="$NEW_KMS"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d minio
```

## Suspected leak

If a secret is **suspected** to have leaked (committed to a public
repo, posted in a Slack channel, found in a log dump):

1. Rotate it immediately — don't wait for the schedule.
2. Force-revoke all `sessions` rows (see above) if it's a JWT secret.
3. Audit access logs for the past 30d for the leaked secret's
   fingerprint (`grep -r` on the `auditlogs` + `accesslogs` exports).
4. Open an incident — `docs/ops/incident.md`.
5. Postmortem must include: how the leak happened, how we'd detect it
   sooner, and which preventive controls are now in place.
