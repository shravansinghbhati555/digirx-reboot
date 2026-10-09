/**
 * Render the clinic lifecycle emails to HTML files and open-able paths, so
 * the templates can be checked in a browser without sending real mail or
 * standing up Mongo.
 *
 *   pnpm preview:emails            -> writes to <os temp>/digirx-email-preview
 *   pnpm preview:emails ./out      -> writes to ./out
 *
 * Sample data only; nothing here touches the database.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

require('ts-node/register');

const {
  clinicRegistrationReceivedEmail,
  clinicRegistrationInternalEmail,
  clinicActivatedEmail,
} = require('../src/modules/notifications/emails/clinic-lifecycle.emails');

const sample = {
  clinicId: '65f1c2d3e4f5a6b7c8d9e0f1',
  clinicName: 'Westside Family Clinic',
  adminName: 'Dr. Laura Bennett',
  adminEmail: 'laura@westside.example',
  countryCode: 'US',
  timezone: 'America/New_York',
  currency: 'USD',
  requestedAt: new Date(),
  logoUrl: process.env.EMAIL_LOGO_URL,
};

const appUrl = (process.env.FRONTEND_URL || 'https://app.digirx.online').replace(/\/+$/, '');

const emails = {
  '1-registration-received': clinicRegistrationReceivedEmail(sample),
  '2-registration-internal': clinicRegistrationInternalEmail({ ...sample, consoleUrl: appUrl }),
  '3-clinic-activated': clinicActivatedEmail({
    clinicName: sample.clinicName,
    adminName: sample.adminName,
    adminEmail: sample.adminEmail,
    loginUrl: appUrl,
    logoUrl: sample.logoUrl,
  }),
};

const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(os.tmpdir(), 'digirx-email-preview');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, email] of Object.entries(emails)) {
  const htmlPath = path.join(outDir, `${name}.html`);
  const textPath = path.join(outDir, `${name}.txt`);
  fs.writeFileSync(htmlPath, email.html, 'utf8');
  fs.writeFileSync(textPath, `Subject: ${email.subject}\n\n${email.text}\n`, 'utf8');
  console.log(`${email.subject}\n  ${htmlPath}\n  ${textPath}`);
}
