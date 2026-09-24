/**
 * Grant, revoke or bootstrap DigiRx platform-administrator access.
 *
 * A platform admin sees the cross-tenant clinic approval queue at
 * /platform/clinics and can approve, reject or suspend any clinic. This is
 * deliberately NOT settable through the API: a clinic's own Super Admin holds
 * every Permission in the enum, so anything expressed as a permission would
 * leak cross-tenant access to customers. The flag only moves from this script.
 *
 * Run:
 *   cd backend
 *   node scripts/platform-admin.cjs list
 *   node scripts/platform-admin.cjs grant you@digirx.online
 *   node scripts/platform-admin.cjs revoke you@digirx.online
 *
 * `bootstrap` is for a database with no operator account yet — a fresh
 * deployment, or a live environment nobody has signed into. It creates the
 * clinic, branch, role and user when they are missing, and when the user
 * already exists it only grants the flag (plus a password reset if one is
 * supplied):
 *
 *   PLATFORM_ADMIN_PASSWORD='...' node scripts/platform-admin.cjs bootstrap \
 *     --email=ops@digirx.online --name='Ops Admin'
 *
 * Point it at another environment with MONGODB_URI, which wins over .env:
 *
 *   MONGODB_URI='mongodb+srv://...' PLATFORM_ADMIN_PASSWORD='...' \
 *     node scripts/platform-admin.cjs bootstrap --email=ops@digirx.online
 *
 * An email that exists in several clinics matches all of them; pass
 * --clinic=<clinicId> to narrow it down.
 *
 * Idempotent — safe to run multiple times.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/digirx';

// Kept in sync with the Permission enum in src/modules/authz/permissions.ts.
// Read from the build when one exists so a rebuilt backend is authoritative;
// the literal is the fallback for a checkout with no dist.
const FALLBACK_PERMISSIONS = [
  'clinic:read', 'clinic:write', 'branch:read', 'branch:write',
  'user:read', 'user:write', 'patient:read', 'patient:write',
  'appointment:read', 'appointment:write', 'billing:read', 'billing:write',
  'document:read', 'document:write', 'notification:read', 'notification:write',
  'audit:read', 'accesslog:read', 'inventory:read', 'inventory:write',
  'pharmacy:read', 'pharmacy:write', 'encounter:read', 'encounter:write',
  'reports:read', 'reports:write', 'dashboard:read',
  'settings:clinic:read', 'settings:branches:read', 'settings:availability:read',
  'settings:notifications:read', 'settings:audit:read',
  'face:enroll', 'face:recognize',
];

function allPermissions() {
  try {
    const mod = require(path.resolve(__dirname, '..', 'dist', 'modules', 'authz', 'permissions.js'));
    const values = Object.values(mod.Permission ?? {});
    if (values.length) return values;
  } catch {
    // dist not built — fall through to the literal
  }
  return FALLBACK_PERMISSIONS;
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags[key] = value ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { command: positional[0], email: positional[1], flags };
}

async function main() {
  const { command, email, flags } = parseArgs(process.argv.slice(2));

  if (!command || !['grant', 'revoke', 'list', 'bootstrap'].includes(command)) {
    console.error('Usage: node scripts/platform-admin.cjs <grant|revoke|list|bootstrap> [email] [--clinic=<id>]');
    console.error("  bootstrap: PLATFORM_ADMIN_PASSWORD='...' node scripts/platform-admin.cjs bootstrap --email=<email> [--name=<name>] [--clinic-name=<clinic>]");
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(MONGODB_URI);
  const users = mongoose.connection.collection('users');
  const clinics = mongoose.connection.collection('clinics');

  // Say which database is being written to. These commands get pointed at
  // live environments, and the only thing between "my laptop" and
  // "production" is an env var.
  console.log(`Database: ${mongoose.connection.name} @ ${mongoose.connection.host}`);

  if (command === 'bootstrap') {
    await bootstrap({ users, clinics, flags });
    await mongoose.disconnect();
    return;
  }

  if (command === 'list') {
    const rows = await users
      .find({ isPlatformAdmin: true })
      .project({ name: 1, email: 1, clinicId: 1, status: 1 })
      .toArray();

    if (rows.length === 0) {
      console.log('No platform administrators yet. Create one with:');
      console.log("  PLATFORM_ADMIN_PASSWORD='...' node scripts/platform-admin.cjs bootstrap --email=you@digirx.online");
    } else {
      console.log(`${rows.length} platform administrator(s):`);
      for (const row of rows) {
        const clinic = await clinics.findOne({ _id: row.clinicId }, { projection: { name: 1 } });
        console.log(`  - ${row.name} <${row.email}>  clinic: ${clinic?.name ?? row.clinicId}  status: ${row.status}`);
      }
    }
    await mongoose.disconnect();
    return;
  }

  if (!email) {
    console.error(`Usage: node scripts/platform-admin.cjs ${command} <email> [--clinic=<id>]`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const filter = { email: String(email).trim().toLowerCase() };
  if (flags.clinic) {
    filter.clinicId = new mongoose.Types.ObjectId(String(flags.clinic));
  }

  const matches = await users.find(filter).project({ name: 1, email: 1, clinicId: 1 }).toArray();

  if (matches.length === 0) {
    console.error(`No user found with email ${email}${flags.clinic ? ` in clinic ${flags.clinic}` : ''}.`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  if (matches.length > 1 && !flags.clinic) {
    console.error(`${matches.length} users share that email. Re-run with --clinic=<id>:`);
    for (const row of matches) {
      const clinic = await clinics.findOne({ _id: row.clinicId }, { projection: { name: 1 } });
      console.error(`  --clinic=${row.clinicId}   (${clinic?.name ?? 'unknown clinic'})`);
    }
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  const grant = command === 'grant';
  const res = await users.updateMany(filter, { $set: { isPlatformAdmin: grant } });
  console.log(
    `${grant ? 'Granted' : 'Revoked'} platform admin for ${email} (${res.modifiedCount} row(s) changed).`,
  );

  await mongoose.disconnect();
}

/**
 * Make sure an operator account exists on this database and can sign in.
 *
 * Creating: a clinic marked ACTIVE (so the approval gate lets it through),
 * one branch, a Super Admin role, and the user carrying the platform flag.
 * Existing: grant the flag, re-activate, and reset the password only when one
 * is supplied.
 */
async function bootstrap({ users, clinics, flags }) {
  const email = String(flags.email ?? '').trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? flags.password;
  const name = String(flags.name ?? 'Platform Admin');
  const clinicName = String(flags['clinic-name'] ?? 'DigiRx Platform');

  if (!email) {
    console.error('bootstrap needs --email=<address>');
    process.exitCode = 1;
    return;
  }

  const existing = await users.findOne({ email });

  if (existing) {
    const update = { isPlatformAdmin: true, status: 'ACTIVE' };
    if (password) {
      update.passwordHash = await bcrypt.hash(String(password), 10);
    }
    await users.updateOne({ _id: existing._id }, { $set: update });
    // An operator whose own clinic sits in the queue could not sign in to
    // approve anything, including themselves.
    await clinics.updateOne(
      { _id: existing.clinicId, status: { $ne: 'ACTIVE' } },
      { $set: { status: 'ACTIVE', statusChangedAt: new Date() } },
    );
    console.log(`Existing user ${email} is now a platform admin${password ? ' (password reset)' : ''}.`);
    console.log('Their clinic is ACTIVE, so they can sign in.');
    return;
  }

  if (!password) {
    console.error('No user with that email exists, so a password is required to create one.');
    console.error(`Re-run with: PLATFORM_ADMIN_PASSWORD='...' node scripts/platform-admin.cjs bootstrap --email=${email}`);
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const clinicId = new mongoose.Types.ObjectId();
  const branchId = new mongoose.Types.ObjectId();
  const roleId = new mongoose.Types.ObjectId();

  await clinics.insertOne({
    _id: clinicId,
    name: clinicName,
    countryCode: String(flags.country ?? 'US').toUpperCase(),
    timezone: String(flags.timezone ?? 'America/New_York'),
    currency: String(flags.currency ?? 'USD').toUpperCase(),
    phoneCountryCode: String(flags['phone-code'] ?? '+1'),
    settings: {},
    // The operator's own clinic is approved by definition.
    status: 'ACTIVE',
    // Not a customer tenant: this is the DigiRx admin workspace. Keeps it out
    // of the approval queue and out of reach of suspend/reject.
    isPlatformClinic: true,
    createdAt: now,
    updatedAt: now,
  });

  await mongoose.connection.collection('branches').insertOne({
    _id: branchId,
    clinicId,
    name: 'Main',
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  await mongoose.connection.collection('roles').insertOne({
    _id: roleId,
    clinicId,
    name: 'Super Admin',
    permissions: allPermissions(),
    createdAt: now,
    updatedAt: now,
  });

  await users.insertOne({
    clinicId,
    branchIds: [branchId],
    defaultBranchId: branchId,
    email,
    name,
    status: 'ACTIVE',
    passwordHash: await bcrypt.hash(String(password), 10),
    roleIds: [roleId],
    isPlatformAdmin: true,
    createdAt: now,
    updatedAt: now,
  });

  console.log(`Created platform admin ${email} in a new clinic "${clinicName}".`);
  console.log(`  clinicId: ${clinicId.toHexString()}`);
  console.log('Sign in with that email and the password you supplied.');
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
