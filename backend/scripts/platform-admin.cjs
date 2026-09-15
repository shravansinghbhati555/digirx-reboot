/**
 * Grant or revoke DigiRx platform-administrator access.
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
 * An email that exists in several clinics matches all of them; pass
 * --clinic=<clinicId> to narrow it down.
 *
 * Idempotent — safe to run multiple times.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/digirx';

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

  if (!command || !['grant', 'revoke', 'list'].includes(command)) {
    console.error('Usage: node scripts/platform-admin.cjs <grant|revoke|list> [email] [--clinic=<id>]');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(MONGODB_URI);
  const users = mongoose.connection.collection('users');
  const clinics = mongoose.connection.collection('clinics');

  if (command === 'list') {
    const rows = await users
      .find({ isPlatformAdmin: true })
      .project({ name: 1, email: 1, clinicId: 1, status: 1 })
      .toArray();

    if (rows.length === 0) {
      console.log('No platform administrators yet. Grant one with:');
      console.log('  node scripts/platform-admin.cjs grant you@digirx.online');
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

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
