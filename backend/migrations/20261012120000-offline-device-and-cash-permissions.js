/* eslint-disable */
// Backfills the two permissions added for offline mode on existing clinics:
//
//   device:manage — view each tablet's unlock code (forgotten-PIN recovery)
//   cash:approve  — sign off the day-end cash count
//
// New clinics get them at signup (Super Admin holds the whole enum; Manager
// lists cash:approve). Existing roles were seeded before these existed, and
// the Super Admin role cannot be edited from the UI, so without this an
// existing clinic's owner could never see an unlock code.
//
//   Super Admin → both
//   Manager     → cash:approve
//
// Idempotent: $addToSet makes a re-run a no-op.

module.exports = {
  async up(db) {
    const roles = db.collection('roles');
    const sa = await roles.updateMany(
      { name: 'Super Admin' },
      { $addToSet: { permissions: { $each: ['device:manage', 'cash:approve'] } } },
    );
    const mgr = await roles.updateMany(
      { name: 'Manager' },
      { $addToSet: { permissions: 'cash:approve' } },
    );
    console.log(
      `[offline-permissions] Super Admin roles updated: ${sa.modifiedCount}, Manager roles updated: ${mgr.modifiedCount}`,
    );
  },

  async down(db) {
    const roles = db.collection('roles');
    await roles.updateMany(
      { name: { $in: ['Super Admin', 'Manager'] } },
      { $pull: { permissions: { $in: ['device:manage', 'cash:approve'] } } },
    );
  },
};
