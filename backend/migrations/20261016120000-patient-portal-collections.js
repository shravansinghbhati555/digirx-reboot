/* eslint-disable */
/**
 * Patient portal: indexes for the collections it adds. Mongoose also
 * asserts these at boot; this migration brings a database up to schema
 * without running the app. Purely additive — no existing collection or
 * document is touched. `createIndex` is idempotent.
 */

module.exports = {
  async up(db) {
    await db.collection('patientaccounts').createIndex(
      { phone: 1 },
      {
        unique: true,
        name: 'patientaccount_phone_unique',
        partialFilterExpression: { phone: { $type: 'string' } },
      },
    );
    await db.collection('patientaccounts').createIndex({ managedByAccountId: 1 });

    await db.collection('patientlinks').createIndex(
      { clinicId: 1, patientId: 1 },
      {
        unique: true,
        name: 'patientlink_active_record_unique',
        partialFilterExpression: { status: 'ACTIVE' },
      },
    );
    await db.collection('patientlinks').createIndex(
      { accountId: 1, status: 1, clinicId: 1 },
      { name: 'patientlink_account_idx' },
    );

    await db.collection('portalotps').createIndex({ phone: 1, createdAt: -1 }, { name: 'portalotp_phone_idx' });
    await db.collection('portalotps').createIndex({ ip: 1, createdAt: -1 }, { name: 'portalotp_ip_idx' });
    await db.collection('portalotps').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 24 * 60 * 60, name: 'portalotp_ttl_idx' },
    );

    await db.collection('portalsessions').createIndex({ accountId: 1 });
    await db.collection('portalsessions').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0, name: 'portalsession_ttl_idx' },
    );

    await db.collection('familyconnections').createIndex(
      { requesterId: 1, targetPhone: 1 },
      {
        unique: true,
        name: 'familyconnection_open_unique',
        partialFilterExpression: { status: { $in: ['PENDING', 'ACTIVE'] } },
      },
    );
    await db.collection('familyconnections').createIndex({ targetId: 1 });
    await db.collection('familyconnections').createIndex({ targetPhone: 1 });

    await db.collection('familygrants').createIndex(
      { granterId: 1, granteeId: 1 },
      { unique: true, name: 'familygrant_pair_unique' },
    );
    await db.collection('familygrants').createIndex({ granteeId: 1 });

    await db.collection('recordaccessgrants').createIndex(
      { accountId: 1, granteeClinicId: 1, status: 1 },
      { name: 'recordaccess_lookup_idx' },
    );

    await db.collection('portalpaymentorders').createIndex({ orderId: 1 }, { unique: true });
    await db.collection('portalpaymentorders').createIndex({ accountId: 1 });
    await db.collection('portalpaymentorders').createIndex({ billId: 1 });
  },

  async down(db) {
    // Indexes only; the collections hold patient data and are not dropped.
    const drops = [
      ['patientaccounts', 'patientaccount_phone_unique'],
      ['patientlinks', 'patientlink_active_record_unique'],
      ['patientlinks', 'patientlink_account_idx'],
      ['portalotps', 'portalotp_phone_idx'],
      ['portalotps', 'portalotp_ip_idx'],
      ['portalotps', 'portalotp_ttl_idx'],
      ['portalsessions', 'portalsession_ttl_idx'],
      ['familyconnections', 'familyconnection_open_unique'],
      ['familygrants', 'familygrant_pair_unique'],
      ['recordaccessgrants', 'recordaccess_lookup_idx'],
    ];
    for (const [coll, name] of drops) {
      await db.collection(coll).dropIndex(name).catch(() => undefined);
    }
  },
};
