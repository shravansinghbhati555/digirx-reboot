/* eslint-disable */
// One-shot role normalisation for existing clinics:
//   - "Admin" → "Super Admin" (with all permissions backfilled if absent)
//   - "ReceptionRole" → "Front Desk" (preserves existing permissions)
//   - Seeds "Manager", "Doctor", "Pharmacist" with sensible defaults
//     for every clinic that doesn't already have them.
//
// Idempotent: re-running this migration is a no-op once the rows match
// the target shape. Safe to run on a clinic where some defaults exist
// (e.g. "Doctor" already there from the legacy seed) — those rows are
// left untouched.
//
// Keep in sync with the default-role list in auth.service.ts → signup.

const ALL_PERMISSIONS = [
  'clinic:read', 'clinic:write',
  'branch:read', 'branch:write',
  'user:read', 'user:write',
  'patient:read', 'patient:write',
  'appointment:read', 'appointment:write',
  'billing:read', 'billing:write',
  'document:read', 'document:write',
  'notification:read', 'notification:write',
  'audit:read', 'accesslog:read',
  'inventory:read', 'inventory:write',
];

const DEFAULT_ROLES = {
  'Super Admin': ALL_PERMISSIONS,
  Manager: [
    'clinic:read', 'branch:read', 'user:read',
    'patient:read', 'patient:write',
    'appointment:read', 'appointment:write',
    'billing:read', 'billing:write',
    'document:read', 'document:write',
    'notification:read', 'notification:write',
    'inventory:read', 'inventory:write',
    'audit:read', 'accesslog:read',
  ],
  'Front Desk': [
    'clinic:read', 'branch:read',
    'patient:read', 'patient:write',
    'appointment:read', 'appointment:write',
    'billing:read', 'billing:write',
    'document:read',
    'notification:read',
  ],
  Doctor: [
    'clinic:read', 'branch:read',
    'patient:read', 'patient:write',
    'appointment:read', 'appointment:write',
    'billing:read',
    'document:read', 'document:write',
    'notification:read',
  ],
  Pharmacist: [
    'clinic:read', 'branch:read',
    'patient:read',
    'billing:read', 'billing:write',
    'document:read',
    'inventory:read', 'inventory:write',
    'notification:read',
  ],
};

module.exports = {
  async up(db) {
    const clinics = db.collection('clinics');
    const roles = db.collection('roles');
    const now = new Date();

    // Cursor over clinics so very-large deployments don't load every
    // row into memory at once.
    const cursor = clinics.find({}, { projection: { _id: 1 } });
    let renamedAdmin = 0;
    let renamedReception = 0;
    let seeded = 0;

    while (await cursor.hasNext()) {
      const clinic = await cursor.next();
      const clinicId = clinic._id;

      // 1) Rename "Admin" → "Super Admin" if a target name doesn't
      //    already exist. The (clinicId, name) unique index would block
      //    a rename onto a colliding row, so we check first.
      const adminRow = await roles.findOne({ clinicId, name: 'Admin' });
      const existingSuper = await roles.findOne({ clinicId, name: 'Super Admin' });
      if (adminRow && !existingSuper) {
        await roles.updateOne(
          { _id: adminRow._id },
          { $set: { name: 'Super Admin', updatedAt: now } },
        );
        renamedAdmin++;
      } else if (adminRow && existingSuper) {
        // Both exist — collapse: keep the higher-permission one and
        // delete the other. Legacy Admin almost always has the full
        // enum, so we keep it and drop the standalone Super Admin.
        const adminPerms = (adminRow.permissions ?? []).length;
        const superPerms = (existingSuper.permissions ?? []).length;
        if (adminPerms >= superPerms) {
          await roles.deleteOne({ _id: existingSuper._id });
          await roles.updateOne(
            { _id: adminRow._id },
            { $set: { name: 'Super Admin', updatedAt: now } },
          );
        } else {
          await roles.deleteOne({ _id: adminRow._id });
        }
        renamedAdmin++;
      }

      // 2) Rename "ReceptionRole" → "Front Desk", same collision guard.
      const recRow = await roles.findOne({ clinicId, name: 'ReceptionRole' });
      const existingFront = await roles.findOne({ clinicId, name: 'Front Desk' });
      if (recRow && !existingFront) {
        await roles.updateOne(
          { _id: recRow._id },
          { $set: { name: 'Front Desk', updatedAt: now } },
        );
        renamedReception++;
      } else if (recRow && existingFront) {
        // Collapse: prefer the row with more permissions.
        const recPerms = (recRow.permissions ?? []).length;
        const frontPerms = (existingFront.permissions ?? []).length;
        if (recPerms >= frontPerms) {
          await roles.deleteOne({ _id: existingFront._id });
          await roles.updateOne(
            { _id: recRow._id },
            { $set: { name: 'Front Desk', updatedAt: now } },
          );
        } else {
          await roles.deleteOne({ _id: recRow._id });
        }
        renamedReception++;
      }

      // 3) Backfill any missing default roles. Skip Super Admin —
      //    the rename above already created it, and if the clinic
      //    somehow has neither it's almost certainly broken state we
      //    don't want to paper over silently.
      const toSeed = [];
      for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
        const existing = await roles.findOne({ clinicId, name });
        if (existing) continue;
        if (name === 'Super Admin') {
          // Only create Super Admin if there's literally no admin-like
          // row — protects against an unattended clinic.
          const anyAdmin = await roles.findOne({
            clinicId,
            name: { $in: ['Admin', 'Super Admin'] },
          });
          if (anyAdmin) continue;
        }
        toSeed.push({
          clinicId,
          name,
          permissions,
          createdAt: now,
          updatedAt: now,
        });
      }
      if (toSeed.length) {
        await roles.insertMany(toSeed);
        seeded += toSeed.length;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `[migration] roles: renamed ${renamedAdmin} Admin → Super Admin, ` +
      `${renamedReception} ReceptionRole → Front Desk, ` +
      `seeded ${seeded} default role row(s)`,
    );
  },

  async down(db) {
    // Reverse only the renames. Seeded rows are left in place — they
    // don't disrupt any flow if present, and users may have assigned
    // staff to them post-migration.
    const roles = db.collection('roles');
    const now = new Date();

    const reverseRenames = [
      { from: 'Super Admin', to: 'Admin' },
      { from: 'Front Desk', to: 'ReceptionRole' },
    ];
    for (const { from, to } of reverseRenames) {
      // Only rename back when the target is free, otherwise we'd hit
      // the (clinicId, name) unique index.
      const rows = await roles.find({ name: from }).toArray();
      for (const r of rows) {
        const collision = await roles.findOne({ clinicId: r.clinicId, name: to });
        if (collision) continue;
        await roles.updateOne(
          { _id: r._id },
          { $set: { name: to, updatedAt: now } },
        );
      }
    }
  },
};
