/* eslint-disable */
/**
 * Initial migration. Captures every index Mongoose currently asserts at
 * application boot — these are reproduced here so future migrations can
 * extend them and so a fresh database that's never run the app can be
 * brought up to schema with `migrate-mongo up` alone.
 *
 * `createIndex` is idempotent at the driver level: calling it for an
 * already-existing index with the same options is a no-op. So this
 * migration is safe to run on an existing prod database.
 *
 * If you change a schema's index later, write a NEW migration — never
 * rewrite this one once it's been applied.
 */

const PARTIAL_QUEUE_FILTER = { type: 'QUEUE' };

module.exports = {
  async up(db) {
    // --- Patients --------------------------------------------------------
    await db.collection('patients').createIndex(
      { clinicId: 1, normalizedName: 1 },
      { name: 'patient_name_idx' },
    );
    await db.collection('patients').createIndex(
      { clinicId: 1, phones: 1 },
      { name: 'patient_phone_idx' },
    );
    await db.collection('patients').createIndex(
      { clinicId: 1, normalizedPhones: 1 },
      { name: 'patient_normalized_phone_idx' },
    );
    await db.collection('patients').createIndex(
      { normalizedName: 'text', phones: 'text' },
      { name: 'patient_text_idx', default_language: 'none' },
    );

    // --- Patient identifiers / MRN counter -------------------------------
    await db.collection('patientidentifiers').createIndex(
      { clinicId: 1, type: 1, value: 1 },
      { unique: true, name: 'patient_identifier_unique_per_clinic' },
    );
    await db.collection('mrncounters').createIndex(
      { clinicId: 1 },
      { unique: true, name: 'mrn_counter_unique_per_clinic' },
    );

    // --- Appointments ----------------------------------------------------
    await db.collection('appointments').createIndex(
      { clinicId: 1, branchId: 1, doctorId: 1, startAt: 1 },
      { name: 'appt_time_lookup_idx' },
    );
    // Partial unique on QUEUE only — TIME rows don't have queueDate/Number
    // and would otherwise collide on null.
    await db.collection('appointments').createIndex(
      {
        clinicId: 1,
        branchId: 1,
        doctorId: 1,
        type: 1,
        queueDate: 1,
        queueNumber: 1,
      },
      {
        unique: true,
        sparse: true,
        name: 'appt_queue_unique_idx',
        partialFilterExpression: PARTIAL_QUEUE_FILTER,
      },
    );
    await db.collection('queuecounters').createIndex(
      { clinicId: 1, branchId: 1, doctorId: 1, queueDate: 1 },
      { unique: true, name: 'queue_counter_unique_idx' },
    );

    // --- Encounters / prescriptions / medicines --------------------------
    await db.collection('encounters').createIndex(
      { clinicId: 1, patientId: 1, visitedAt: -1 },
      { name: 'encounter_patient_history_idx' },
    );
    await db.collection('prescriptions').createIndex(
      { clinicId: 1, patientId: 1, createdAt: -1 },
      { name: 'rx_patient_idx' },
    );
    await db.collection('prescriptions').createIndex(
      { shareToken: 1 },
      { sparse: true, name: 'rx_share_token_idx' },
    );
    await db.collection('medicinecatalogitems').createIndex(
      { clinicId: 1, name: 1 },
      { unique: true, name: 'medicine_unique_name_per_clinic' },
    );
    await db.collection('medicinecatalogitems').createIndex(
      { name: 'text', genericName: 'text', composition: 'text' },
      { name: 'medicine_text_idx', default_language: 'none' },
    );

    // --- Billing ---------------------------------------------------------
    await db.collection('bills').createIndex(
      { clinicId: 1, branchId: 1, createdAt: -1 },
      { name: 'bill_branch_created_idx' },
    );
    await db.collection('bills').createIndex(
      { clinicId: 1, branchId: 1, billNo: 1 },
      { unique: true, sparse: true, name: 'billno_unique_per_branch' },
    );
    await db.collection('billcounters').createIndex(
      { clinicId: 1, branchId: 1, fiscalYear: 1 },
      { unique: true, name: 'bill_counter_unique_per_branch_year' },
    );
    await db.collection('payments').createIndex(
      { clinicId: 1, billId: 1, paidAt: -1 },
      { name: 'payment_bill_paidAt_idx' },
    );
    await db.collection('payments').createIndex(
      { clinicId: 1, billId: 1, idempotencyKey: 1 },
      {
        unique: true,
        name: 'payment_idempotency_unique_idx',
        partialFilterExpression: { idempotencyKey: { $type: 'string' } },
      },
    );
    await db.collection('servicecatalogitems').createIndex(
      { clinicId: 1, name: 1 },
      { unique: true, name: 'service_catalog_unique_name_per_clinic' },
    );
    await db.collection('servicecatalogitems').createIndex(
      { name: 'text' },
      { name: 'service_catalog_text_idx', default_language: 'none' },
    );

    // --- Credit notes ----------------------------------------------------
    await db.collection('creditnotes').createIndex(
      { clinicId: 1, billId: 1, createdAt: -1 },
      { name: 'cn_bill_created_idx' },
    );
    await db.collection('creditnotes').createIndex(
      { clinicId: 1, branchId: 1, creditNoteNo: 1 },
      { unique: true, sparse: true, name: 'cn_unique_no_per_branch' },
    );
    await db.collection('creditnotecounters').createIndex(
      { clinicId: 1, branchId: 1, fiscalYear: 1 },
      { unique: true, name: 'cn_counter_unique_per_branch_year' },
    );

    // --- Documents -------------------------------------------------------
    await db.collection('documents').createIndex(
      { clinicId: 1, ownerType: 1, ownerId: 1, createdAt: -1 },
      { name: 'doc_owner_idx' },
    );
    await db.collection('documentshares').createIndex(
      { token: 1 },
      { unique: true, name: 'document_share_token_unique_idx' },
    );

    // --- Notifications ---------------------------------------------------
    await db.collection('notificationtemplates').createIndex(
      { clinicId: 1, channel: 1, key: 1 },
      { unique: true, name: 'notification_template_unique' },
    );
    await db.collection('notificationlogs').createIndex(
      { clinicId: 1, createdAt: -1 },
      { name: 'notification_log_clinic_created_idx' },
    );
    await db.collection('notificationlogs').createIndex(
      { clinicId: 1, dedupeKey: 1 },
      {
        unique: true,
        name: 'notification_log_dedupe_unique',
        partialFilterExpression: { dedupeKey: { $type: 'string' } },
      },
    );

    // --- Audit / access logs (with TTL) ----------------------------------
    await db.collection('auditlogs').createIndex(
      { clinicId: 1, createdAt: -1 },
      { name: 'audit_clinic_createdAt_idx' },
    );
    await db.collection('auditlogs').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'audit_ttl_idx' },
    );
    await db.collection('accesslogs').createIndex(
      { clinicId: 1, createdAt: -1 },
      { name: 'accesslog_clinic_created_idx' },
    );
    await db.collection('accesslogs').createIndex(
      { clinicId: 1, path: 1, createdAt: -1 },
      { name: 'accesslog_path_created_idx' },
    );
    await db.collection('accesslogs').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'accesslog_ttl_idx' },
    );

    // --- Identity & access -----------------------------------------------
    await db.collection('clinics').createIndex(
      { name: 1 },
      { name: 'clinic_name_idx' },
    );
    await db.collection('branches').createIndex(
      { clinicId: 1, name: 1 },
      { unique: true, name: 'branch_unique_name_per_clinic' },
    );
    await db.collection('branches').createIndex(
      { clinicId: 1, code: 1 },
      { unique: true, sparse: true, name: 'branch_unique_code_per_clinic' },
    );
    await db.collection('users').createIndex(
      { clinicId: 1, email: 1 },
      { unique: true, sparse: true, name: 'user_unique_email_per_clinic' },
    );
    await db.collection('users').createIndex(
      { clinicId: 1, phone: 1 },
      { unique: true, sparse: true, name: 'user_unique_phone_per_clinic' },
    );
    await db.collection('roles').createIndex(
      { clinicId: 1, name: 1 },
      { unique: true, name: 'role_unique_name_per_clinic' },
    );
    await db.collection('doctoravailabilityrules').createIndex(
      { clinicId: 1, branchId: 1, doctorUserId: 1, weekday: 1 },
      { unique: true, name: 'uniq_rule_per_day' },
    );
    await db.collection('doctoravailabilityoverrides').createIndex(
      { clinicId: 1, branchId: 1, doctorUserId: 1, date: 1 },
      { unique: true, name: 'uniq_override_per_date' },
    );
  },

  async down() {
    // Initial migration is intentionally one-way: rolling back would drop
    // every index in the database. If you need to undo a specific index,
    // write a targeted migration.
    throw new Error('initial-indexes is not reversible — write a targeted migration');
  },
};
