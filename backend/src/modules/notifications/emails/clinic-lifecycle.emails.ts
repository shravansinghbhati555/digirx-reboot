import { DateTime } from 'luxon';
import {
  BrandedEmailInput,
  RenderedEmail,
  renderBrandedEmail,
} from './branded-email';

/**
 * The mails a clinic gets around its approval: one when it registers, one
 * when we let it in — plus the internal heads-up that puts a new
 * registration in front of the platform team.
 *
 * Copy lives here rather than in the services so the wording can be read and
 * changed in one place, and so the tests can assert on it without standing up
 * Mongo or a mail transport.
 */

export type ClinicLifecycleEmail = RenderedEmail & { subject: string };

type SignupContext = {
  clinicName: string;
  adminName: string;
  adminEmail: string;
  countryCode?: string;
  timezone?: string;
  currency?: string;
  clinicId?: string;
  requestedAt?: Date;
  logoUrl?: string;
};

/** First name only — "Thanks, Laura" reads better than "Thanks, Dr. Laura Bennett". */
function firstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  // Keep the honorific when there is one: "Dr. Laura" beats "Dr.".
  if (parts.length > 1 && /^(dr|mr|mrs|ms|prof)\.?$/i.test(parts[0])) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0] || name.trim();
}

function formatWhen(at: Date, timezone?: string): string {
  const dt = DateTime.fromJSDate(at).setZone(timezone || 'UTC');
  const safe = dt.isValid ? dt : DateTime.fromJSDate(at).setZone('UTC');
  return safe.toFormat("d LLL yyyy 'at' HH:mm ZZZZ");
}

function build(
  subject: string,
  input: BrandedEmailInput,
): ClinicLifecycleEmail {
  return { subject, ...renderBrandedEmail(input) };
}

/**
 * To the person who registered: we have it, it is not live yet, and nothing
 * is required from them.
 *
 * Says plainly that sign-in won't work until approval, because the most
 * likely next thing they do is try to log in and hit the PENDING refusal
 * from `AuthService.assertClinicCanSignIn` with no idea why.
 */
export function clinicRegistrationReceivedEmail(
  ctx: SignupContext,
): ClinicLifecycleEmail {
  const submitted = ctx.requestedAt ?? new Date();

  return build(
    `We've received your DigiRx registration for ${ctx.clinicName}`,
    {
      preheader: `${ctx.clinicName} is in the approval queue — we'll email you the moment it's live.`,
      eyebrow: 'Registration received',
      heading: `Thanks, ${firstName(ctx.adminName)} — we've got ${ctx.clinicName}.`,
      lead: 'Your clinic is registered and now sits with our team for a quick review.',
      paragraphs: [
        'We check every new clinic by hand before switching it on. It usually takes less than one business day, and there is nothing for you to do in the meantime.',
        "The moment it's approved, we'll email you at this address with a link to sign in.",
      ],
      factsTitle: 'What we registered',
      facts: [
        { label: 'Clinic', value: ctx.clinicName },
        { label: 'Administrator', value: ctx.adminName },
        { label: 'Sign-in email', value: ctx.adminEmail },
        { label: 'Submitted', value: formatWhen(submitted, ctx.timezone) },
        { label: 'Status', value: 'Awaiting approval' },
      ],
      callout: {
        title: 'Sign-in is not open yet',
        text: "Until a DigiRx admin approves the clinic, logging in will be refused — that's expected, and not a problem with your password.",
      },
      signOff: 'Warm regards,\nThe DigiRx team',
      footerNote:
        'You received this because this address was used to register a clinic on DigiRx.',
      logoUrl: ctx.logoUrl,
    },
  );
}

/**
 * To the platform inbox (LEADS_NOTIFY_EMAIL): a clinic is blocked until
 * somebody acts, so this one leads with the facts needed to decide.
 */
export function clinicRegistrationInternalEmail(
  ctx: SignupContext & { consoleUrl?: string },
): ClinicLifecycleEmail {
  const submitted = ctx.requestedAt ?? new Date();

  const facts = [
    { label: 'Clinic', value: ctx.clinicName },
    { label: 'Administrator', value: ctx.adminName },
    { label: 'Email', value: ctx.adminEmail },
    { label: 'Country', value: ctx.countryCode || 'not set' },
    { label: 'Timezone', value: ctx.timezone || 'not set' },
    { label: 'Currency', value: ctx.currency || 'not set' },
    { label: 'Registered', value: formatWhen(submitted, ctx.timezone) },
  ];
  if (ctx.clinicId) facts.push({ label: 'Clinic ID', value: ctx.clinicId });

  return build(`New clinic awaiting approval: ${ctx.clinicName}`, {
    preheader: `${ctx.adminName} registered ${ctx.clinicName} and is waiting to be let in.`,
    eyebrow: 'Approval queue',
    heading: `${ctx.clinicName} just registered`,
    lead: 'A new clinic is sitting in the approval queue.',
    paragraphs: [
      'Nobody at this clinic can sign in until it is approved, so they are waiting on us.',
    ],
    factsTitle: 'Registration details',
    facts,
    cta: ctx.consoleUrl
      ? { label: 'Open the approval queue', url: ctx.consoleUrl }
      : undefined,
    footerNote:
      'Sent to the DigiRx platform inbox because a new clinic registered.',
    logoUrl: ctx.logoUrl,
  });
}

/** To the person who registered, once an admin approves the clinic. */
export function clinicActivatedEmail(ctx: {
  clinicName: string;
  adminName?: string;
  adminEmail?: string;
  loginUrl?: string;
  logoUrl?: string;
}): ClinicLifecycleEmail {
  const greeting = ctx.adminName
    ? `${firstName(ctx.adminName)}, you're`
    : "You're";

  return build(`${ctx.clinicName} is live on DigiRx`, {
    preheader: `${ctx.clinicName} has been approved — your clinic is open for business.`,
    eyebrow: 'Approved',
    heading: `${greeting} live. Let's open the doors.`,
    lead: `${ctx.clinicName} has been approved, and your DigiRx account is active from right now.`,
    paragraphs: [
      'Sign in with the email and password you chose when you registered. You land in as Manager, so everything is already yours to set up.',
      'A good first hour: add your branches, invite your staff and give them roles, set doctor availability, then register your first patient. Appointments, prescriptions, billing and reports are all waiting behind that.',
    ],
    callout: {
      tone: 'success',
      title: 'Your clinic is switched on',
      text: 'Every feature on your plan is available now — no further approval needed.',
    },
    cta: ctx.loginUrl
      ? { label: 'Sign in to DigiRx', url: ctx.loginUrl }
      : undefined,
    signOff:
      "Glad to have you with us. If anything looks off in your first week, reply to your welcome thread and we'll sort it out.\n\nThe DigiRx team",
    footerNote: ctx.adminEmail
      ? `Sent to ${ctx.adminEmail}, the administrator address for ${ctx.clinicName}.`
      : undefined,
    logoUrl: ctx.logoUrl,
  });
}
