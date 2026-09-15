/* eslint-disable */
// Backfills the clinic onboarding status introduced with the approval queue.
//
// Every clinic that existed before the queue was built is already a paying
// tenant, so they all become ACTIVE. Only clinics created through signup
// after this migration start life as PENDING.
//
// Idempotent: re-running only touches rows that still lack a status.

module.exports = {
  async up(db) {
    const res = await db
      .collection('clinics')
      .updateMany(
        { status: { $exists: false } },
        { $set: { status: 'ACTIVE' } },
      );
    console.log(`[clinic-onboarding-status] activated ${res.modifiedCount} existing clinic(s)`);

    await db
      .collection('clinics')
      .createIndex({ status: 1, createdAt: -1 }, { name: 'clinic_status_created_idx' });

    // Platform-admin lookups run on every call to /platform/*.
    await db
      .collection('users')
      .createIndex({ isPlatformAdmin: 1 }, { name: 'user_platform_admin_idx' });
  },

  async down(db) {
    await db.collection('clinics').dropIndex('clinic_status_created_idx').catch(() => {});
    await db.collection('users').dropIndex('user_platform_admin_idx').catch(() => {});
    // Status itself is intentionally left in place: dropping it would be
    // indistinguishable from "never approved" for clinics onboarded since.
  },
};
