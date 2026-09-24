/* eslint-disable */
// Marks the DigiRx team's own workspace so the approval queue stops treating
// it as a customer clinic.
//
// The operator's admins have to belong to *some* clinic, so bootstrapping a
// platform admin creates one. It then showed up in the queue alongside real
// tenants, where a stray click suspended it — and a suspended workspace locks
// its own admins out of the console they would use to undo that.
//
// Which clinics count: a clinic where every user is a platform admin. A
// customer clinic that happens to employ one (someone at DigiRx with a staff
// account there) has ordinary users too, so it is left alone.
//
// Idempotent: re-running re-evaluates the same rule and sets the same flag.

module.exports = {
  async up(db) {
    const platformAdminClinicIds = await db
      .collection('users')
      .distinct('clinicId', { isPlatformAdmin: true });

    if (platformAdminClinicIds.length === 0) {
      console.log('[platform-clinic-flag] no platform admins found — nothing to mark');
      return;
    }

    // Clinics from that set that also contain at least one ordinary user are
    // real tenants, not the operator's workspace.
    const mixedClinicIds = await db.collection('users').distinct('clinicId', {
      clinicId: { $in: platformAdminClinicIds },
      isPlatformAdmin: { $ne: true },
    });
    const mixed = new Set(mixedClinicIds.map((id) => String(id)));
    const platformClinicIds = platformAdminClinicIds.filter(
      (id) => !mixed.has(String(id)),
    );

    if (platformClinicIds.length === 0) {
      console.log(
        '[platform-clinic-flag] every clinic with a platform admin also has ordinary staff — nothing marked',
      );
      return;
    }

    const named = await db
      .collection('clinics')
      .find({ _id: { $in: platformClinicIds } }, { projection: { name: 1, status: 1 } })
      .toArray();
    for (const clinic of named) {
      console.log(`[platform-clinic-flag] marking "${clinic.name}" as the platform workspace`);
    }

    await db
      .collection('clinics')
      .updateMany({ _id: { $in: platformClinicIds } }, { $set: { isPlatformClinic: true } });

    // The workspace is approved by definition, and its status can no longer be
    // changed through the API — so repair any row left suspended or rejected
    // by the queue before it was hidden.
    const repaired = await db.collection('clinics').updateMany(
      { _id: { $in: platformClinicIds }, status: { $ne: 'ACTIVE' } },
      { $set: { status: 'ACTIVE', statusReason: null } },
    );
    if (repaired.modifiedCount > 0) {
      console.log(
        `[platform-clinic-flag] restored ${repaired.modifiedCount} platform workspace(s) to ACTIVE`,
      );
    }

    await db
      .collection('clinics')
      .createIndex({ isPlatformClinic: 1 }, { name: 'clinic_platform_idx' });
  },

  async down(db) {
    await db.collection('clinics').dropIndex('clinic_platform_idx').catch(() => {});
    await db
      .collection('clinics')
      .updateMany({ isPlatformClinic: true }, { $unset: { isPlatformClinic: '' } });
    // Status is left as it is: ACTIVE is correct for the workspace either way.
  },
};
