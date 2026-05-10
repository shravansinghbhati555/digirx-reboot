# Data Subject Rights (DSR) playbook

Patients have the right to **request a copy** of their data and the right
to **request deletion**. This playbook is the operator-facing procedure;
legal sets the timelines and the wording of the response letter.

## Verifying the requester

Before exporting or deleting anything:

1. Confirm the request comes through an authenticated channel (the
   clinic's official email, a signed letter, the patient's logged-in
   portal session).
2. Match identifying details (full name + DOB + phone + MRN) against
   the `patients` collection. Two of three must match.
3. If the request is on behalf of a deceased patient, require the next-of-kin
   declaration legal sends (out of band).

## Export — "give me my data"

The output is a single JSON file per patient. Run from the `backend/`
working dir (production:`docker compose exec backend ...`):

```bash
node -e '
  const m = require("mongoose");
  await m.connect(process.env.MONGODB_URI);
  const PID = m.Types.ObjectId("<patientId>");
  const out = {};
  out.patient = await m.connection.db.collection("patients").findOne({_id: PID});
  out.identifiers = await m.connection.db.collection("patientidentifiers").find({patientId: PID}).toArray();
  out.appointments = await m.connection.db.collection("appointments").find({patientId: PID}).toArray();
  out.encounters = await m.connection.db.collection("encounters").find({patientId: PID}).toArray();
  out.prescriptions = await m.connection.db.collection("prescriptions").find({patientId: PID}).toArray();
  out.bills = await m.connection.db.collection("bills").find({patientId: PID}).toArray();
  out.payments = await m.connection.db.collection("payments").find({billId: {$in: out.bills.map(b => b._id)}}).toArray();
  out.creditNotes = await m.connection.db.collection("creditnotes").find({billId: {$in: out.bills.map(b => b._id)}}).toArray();
  out.documents = await m.connection.db.collection("documents").find({ownerType: "PATIENT", ownerId: PID}).toArray();
  out.notificationLogs = await m.connection.db.collection("notificationlogs").find({to: {$in: out.patient.phones || []}}).toArray();
  console.log(JSON.stringify(out, null, 2));
  await m.disconnect();
' > dsr-export-<patientId>.json
```

Hand-deliver via legal's preferred channel (encrypted-at-rest cloud
folder, signed PDF). **Do not email the JSON in cleartext.**

## Deletion — "forget me"

Deletion has cascading effects. **Read this whole section before
running anything.**

### What we delete

- `patients` row (hard delete)
- `patientidentifiers` rows (hard delete)
- `appointments` rows (hard delete)
- `encounters` rows (hard delete)
- `prescriptions` rows (hard delete)
- `documents` rows: hard delete + S3 object purge
- `notificationlogs`: PII-scrubbed, not row-deleted (so the audit chain
  for "did we send this person an SMS" stays intact at the count level
  even if the body / phone are gone)
- `auditlogs` referencing the patient: PII-scrubbed (entityId is kept;
  meta is replaced with `{redacted: true}`)

### What we keep (and why)

- **Bills + payments + credit notes** with the original `patientId`
  retained but `patientId` replaced with the synthetic `DELETED_PATIENT`
  marker, and `billNo` retained. Financial records are required to be
  kept by tax law for 7 years; pulling them would put the clinic in
  violation of a different law.
- The clinic's books still need to balance after a deletion, so the
  reports' totals don't change.

### Procedure

1. **Take a backup** before running anything destructive
   (`docs/ops/restore.md`).
2. Confirm the request is verified (above).
3. Run the export first — the patient is entitled to their data **and**
   we want the snapshot for legal in case of dispute.
4. Run the deletion script (TODO: ship `pnpm dsr:delete <patientId>`
   as a real script — for now it's a hand-rolled session below).

```js
// In a mongosh session against production. DOUBLE-CHECK the patientId.
const PID = ObjectId("<patientId>");

// Hard deletes.
db.patients.deleteOne({_id: PID});
db.patientidentifiers.deleteMany({patientId: PID});
db.appointments.deleteMany({patientId: PID});
db.encounters.deleteMany({patientId: PID});
db.prescriptions.deleteMany({patientId: PID});

// Documents — collect S3 keys first so we can purge the bucket.
const docs = db.documents.find({ownerType: "PATIENT", ownerId: PID}).toArray();
print("Will purge S3 keys:");
docs.forEach(d => print("  " + d.storageKey));
db.documents.deleteMany({ownerType: "PATIENT", ownerId: PID});

// Bills/payments/CNs — keep but anonymise.
const SENTINEL = ObjectId("000000000000000000000001");
db.bills.updateMany({patientId: PID}, {$set: {patientId: SENTINEL, patientNameSnapshot: null}});

// Audit logs — scrub meta but keep the row.
db.auditlogs.updateMany(
  {entityType: "patients", entityId: PID.toString()},
  {$set: {meta: {redacted: true}}}
);

// Notification logs — scrub phone + body, keep the row.
db.notificationlogs.updateMany(
  {to: {$in: <patient.phones>}},
  {$set: {to: "[REDACTED]", body: "[REDACTED]"}}
);
```

5. After the DB ops complete, purge S3 objects for the recorded
   `storageKey`s using `mc rm` against the MinIO bucket.
6. File the deletion in the DSR tracking sheet: patient anonymised id,
   request date, deletion date, sign-off from legal.

## Timelines

- Acknowledge receipt: 72 hours (statutory floor).
- Complete export: 30 days.
- Complete deletion: 30 days, can be extended to 90 days if data is
  spread across multiple systems (we are single-system today, so 30).

## What if deletion would harm clinical care?

Patients can withdraw consent for processing, but if removing the data
would leave another patient without context (rare — would only happen
in shared-record scenarios), the clinic may refuse the deletion under
"public interest in healthcare" grounds. Legal makes that call, not
the operator running the script.
