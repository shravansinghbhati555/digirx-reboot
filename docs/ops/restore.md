# Backup & Restore Runbook

> **Audience:** Anyone on call. Assume the worst case — production Mongo is unrecoverable; you have nothing but the latest S3 backup.
>
> **RTO target:** 1 hour to a working read-write replica from a fresh node.
> **RPO target:** ≤ 24 hours of data loss (matches the daily backup cadence).

---

## 1. What gets backed up

A nightly cron (see `infra/cron/mongo-backup.sh`, **TODO: out of repo scope**) runs:

```bash
mongodump \
  --uri "$MONGODB_URI" \
  --gzip \
  --archive=/tmp/digirx-$(date -u +%Y%m%dT%H%M%SZ).gz
aws s3 cp /tmp/digirx-*.gz s3://digirx-backups/daily/
```

S3 lifecycle rules:

- `s3://digirx-backups/daily/` — STANDARD, deleted after **30 days**.
- Auto-transition to **Glacier** after 30 days, retained for **12 months**.

**Manual checkpoint** (anytime, e.g. before a risky migration):

```bash
mongodump --uri "$MONGODB_URI" --gzip --archive=/tmp/checkpoint.gz
aws s3 cp /tmp/checkpoint.gz s3://digirx-backups/manual/
```

---

## 2. Restore — full database to a fresh Mongo

When prod is gone and you need a working DB to point the app at.

### 2.1 Provision a fresh Mongo

```bash
# Pick the most recent backup
aws s3 ls s3://digirx-backups/daily/ | sort | tail -3
aws s3 cp s3://digirx-backups/daily/digirx-20261001T020000Z.gz /tmp/restore.gz

# Spin up a fresh single-node replica set (or use a managed instance).
docker run -d --name mongo-restore \
  -p 27017:27017 \
  -v mongo-restore-data:/data/db \
  mongo:7 --replSet rs0
docker exec mongo-restore mongosh --eval 'rs.initiate()'
```

### 2.2 Apply the backup

```bash
mongorestore \
  --uri "mongodb://localhost:27017/?replicaSet=rs0" \
  --gzip --archive=/tmp/restore.gz \
  --drop  # drops the target database before restoring
```

### 2.3 Re-create indexes via migrate-mongo

`mongorestore` restores data + indexes the dump captured. As a safety
net (e.g. you restored from a partial / pre-1.5 dump), run the
idempotent migration:

```bash
cd backend
MONGODB_URI="mongodb://localhost:27017/digirx?replicaSet=rs0" \
  pnpm migrate:up
```

### 2.4 Point the app at the restored Mongo

Update the application's `MONGODB_URI` (env var or secret-manager entry)
to the new endpoint, redeploy, and verify:

```bash
curl -fsS https://api.digirx.com/health | jq
# Expect: { "ok": true, "deps": { "mongo": "up", ... } }
```

---

## 3. Point-in-time recovery (single-document or single-collection)

Don't restore the whole database. Use `mongorestore` with collection
filters and a **temporary database name**, then copy the rows you need.

```bash
# Restore the day-before-incident dump into a temp DB
mongorestore \
  --uri "mongodb://localhost:27017" \
  --gzip --archive=/tmp/restore.gz \
  --nsFrom "digirx.*" --nsTo "digirx_recover.*"

# Copy a specific document back
mongosh --eval '
  const src = db.getSiblingDB("digirx_recover").bills.findOne({_id: ObjectId("...")});
  db.getSiblingDB("digirx").bills.insertOne(src);
'

# Drop the temp DB
mongosh --eval 'db.getSiblingDB("digirx_recover").dropDatabase()'
```

---

## 4. Restore drill — quarterly

A backup you've never restored is not a backup. Run this drill every
quarter:

1. Pick yesterday's backup.
2. Provision a throwaway Mongo (above).
3. Restore it.
4. Run `pnpm seed` against the throwaway DB to confirm the schema is
   compatible with the current app version (the seed is idempotent).
5. Diff a known-stable count from prod: `db.patients.countDocuments()`,
   `db.bills.countDocuments()`. They should match the backup snapshot
   to within ±0.1%.
6. Time the entire process. If it took more than the 1-hour RTO target,
   investigate where the wall-clock budget went.
7. Tear the throwaway down.

Record the drill in `docs/ops/incidents/restore-drill-YYYY-MM-DD.md`.

---

## 5. Migration philosophy

- Every schema change ships with its own `migrate-mongo` migration.
- Migrations are **idempotent** — `createIndex` with the same options is
  a no-op. So re-running a migration on a partially-applied database
  (e.g. after a restore) is safe.
- Migrations are **forward-only** for index changes. The initial
  migration's `down` throws because rolling it back would drop every
  index. Targeted index removals get their own migration.
- Generate one with: `pnpm migrate:create my-migration-name`.
- Apply with: `pnpm migrate:up`.
- Inspect status with: `pnpm migrate:status`.
- The CLI tracks applied migrations in the `migrate_changelog`
  collection.

---

## 6. What's intentionally out of scope of this runbook

- The cron / backup infra (`infra/cron/mongo-backup.sh`, S3 lifecycle
  rules, IAM permissions) — those live in the infra repo, not this one.
- BullMQ / Redis state — Redis is rebuildable from Mongo + replaying any
  in-flight notification logs (status: QUEUED). No Redis backup
  necessary; just restart the worker after Mongo's back.
- S3 document content — separate bucket, separate replication policy.
  Documents are content-addressed by `storageKey` so a missing object
  surfaces as a 404 on download, not a corrupt bill.
