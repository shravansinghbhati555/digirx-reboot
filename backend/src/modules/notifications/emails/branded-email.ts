import { escapeHtml } from '../providers/email-format';

/**
 * The one HTML shell every DigiRx-branded email is rendered into.
 *
 * Why a hand-written table layout instead of a template engine: email
 * clients (Outlook especially) support a small, old subset of HTML/CSS.
 * Flexbox, grid, classes and external stylesheets are unreliable, so this
 * uses nested tables with inline styles — the format that renders the same
 * in Gmail, Outlook, Apple Mail and on phones.
 *
 * Colours mirror the product's own tokens (`frontend/src/index.css`) and the
 * marketing site's `--medical-red`, so an email reads as the same product as
 * the app and the website.
 *
 * Every caller-supplied string is treated as plain text and escaped — these
 * bodies carry clinic names and email addresses typed by strangers at signup,
 * so none of it may reach the markup unescaped.
 */

const PALETTE = {
  brand: '#F44336',
  brandDeep: '#E53935',
  brandDark: '#C62828',
  brandSoft: '#FEF2F2',
  pageBg: '#F4F6F8',
  surface: '#FFFFFF',
  border: '#E5E9EF',
  text: '#0F172A',
  textMuted: '#5A6473',
  textSubtle: '#8993A4',
  successText: '#065F46',
  successBg: '#ECFDF5',
  successBorder: '#A7F3D0',
  infoText: '#4338CA',
  infoBg: '#EEF2FF',
  infoBorder: '#C7D2FE',
} as const;

// Brand fonts first (Inter / Manrope, as the app loads them), then the
// system stack every mail client actually has.
const FONT_BODY =
  "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const FONT_DISPLAY =
  "'Manrope','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** A label/value row in the summary block. */
export type EmailFact = { label: string; value: string };

export type BrandedEmailInput = {
  /** Inbox preview line. Shown next to the subject, never in the body. */
  preheader: string;
  /** Small uppercase kicker above the heading. */
  eyebrow?: string;
  heading: string;
  /** Opening line, set slightly larger than body copy. */
  lead?: string;
  paragraphs?: string[];
  factsTitle?: string;
  facts?: EmailFact[];
  cta?: { label: string; url: string };
  /** Tinted box for the one thing the reader should not miss. */
  callout?: { title?: string; text: string; tone?: 'info' | 'success' };
  signOff?: string;
  /** Small print under the card, e.g. why this email was sent. */
  footerNote?: string;
  /** Absolute URL to a hosted logo; falls back to a text wordmark. */
  logoUrl?: string;
};

/** Both MIME parts of one email, built from a single description. */
export type RenderedEmail = { html: string; text: string };

export function renderBrandedEmail(input: BrandedEmailInput): RenderedEmail {
  return { html: renderHtml(input), text: renderText(input) };
}

function renderHtml(input: BrandedEmailInput): string {
  const masthead = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="132" alt="digiRx" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:132px;" />`
    : `<span style="font-family:${FONT_DISPLAY};font-size:26px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">digi<span style="color:#FFE3E1;">Rx</span></span>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<!-- Tell clients this design is light-only so they don't auto-invert it. -->
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(input.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PALETTE.pageBg};-webkit-text-size-adjust:100%;">
<div style="display:none;font-size:1px;color:${PALETTE.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(
    input.preheader,
  )}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${
    PALETTE.pageBg
  };">
<tr>
<td align="center" style="padding:0 0 32px 0;">
<!-- Full-bleed: the card spans the window rather than sitting in the usual
     600px column, so there is no gutter down either side. -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">

<!-- Masthead: solid brand fill, with a gradient on clients that support it. -->
<tr>
<td bgcolor="${PALETTE.brandDeep}" style="background-color:${PALETTE.brandDeep};background-image:linear-gradient(135deg,${
    PALETTE.brand
  } 0%,${PALETTE.brandDeep} 55%,${
    PALETTE.brandDark
  } 100%);padding:26px 32px;">
${masthead}
<div style="font-family:${FONT_BODY};font-size:12px;line-height:18px;color:#FFD9D6;padding-top:6px;letter-spacing:0.3px;">AI Native Clinic OS</div>
</td>
</tr>

<!-- Card -->
<tr>
<td bgcolor="${PALETTE.surface}" style="background-color:${PALETTE.surface};border-bottom:1px solid ${
    PALETTE.border
  };padding:32px;">
${input.eyebrow ? eyebrowHtml(input.eyebrow) : ''}
<h1 style="margin:0 0 14px 0;font-family:${FONT_DISPLAY};font-size:25px;line-height:32px;font-weight:800;letter-spacing:-0.4px;color:${
    PALETTE.text
  };">${escapeHtml(input.heading)}</h1>
${input.lead ? leadHtml(input.lead) : ''}
${(input.paragraphs ?? []).map(paragraphHtml).join('\n')}
${input.facts?.length ? factsHtml(input.factsTitle, input.facts) : ''}
${input.callout ? calloutHtml(input.callout) : ''}
${input.cta ? ctaHtml(input.cta) : ''}
${input.signOff ? signOffHtml(input.signOff) : ''}
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:22px 32px 0 32px;font-family:${FONT_BODY};font-size:12px;line-height:19px;color:${
    PALETTE.textSubtle
  };" align="center">
${
  input.footerNote
    ? `<div style="padding-bottom:8px;">${escapeHtml(input.footerNote)}</div>`
    : ''
}
<div>&copy; ${new Date().getFullYear()} digiRx &middot; This is an automated message, so please don't reply directly to it.</div>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

function eyebrowHtml(eyebrow: string): string {
  return `<div style="font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${
    PALETTE.brandDeep
  };padding-bottom:10px;">${escapeHtml(eyebrow)}</div>`;
}

function leadHtml(lead: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONT_BODY};font-size:16px;line-height:26px;color:${
    PALETTE.text
  };">${escapeHtml(lead)}</p>`;
}

function paragraphHtml(text: string): string {
  return `<p style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:15px;line-height:25px;color:${
    PALETTE.textMuted
  };">${escapeHtml(text)}</p>`;
}

function factsHtml(title: string | undefined, facts: EmailFact[]): string {
  const rows = facts
    .map(
      (fact) => `<tr>
<td style="padding:7px 0;font-family:${FONT_BODY};font-size:13px;line-height:20px;color:${
        PALETTE.textSubtle
      };white-space:nowrap;vertical-align:top;width:132px;">${escapeHtml(fact.label)}</td>
<td style="padding:7px 0;font-family:${FONT_BODY};font-size:14px;line-height:21px;font-weight:600;color:${
        PALETTE.text
      };vertical-align:top;word-break:break-word;">${escapeHtml(fact.value)}</td>
</tr>`,
    )
    .join('\n');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F9FAFB;border:1px solid ${
    PALETTE.border
  };border-radius:12px;margin:6px 0 20px 0;">
<tr><td style="padding:14px 18px;">
${
  title
    ? `<div style="font-family:${FONT_BODY};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${
        PALETTE.textSubtle
      };padding-bottom:6px;">${escapeHtml(title)}</div>`
    : ''
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows}
</table>
</td></tr>
</table>`;
}

function calloutHtml(
  callout: NonNullable<BrandedEmailInput['callout']>,
): string {
  const success = callout.tone === 'success';
  const bg = success ? PALETTE.successBg : PALETTE.infoBg;
  const border = success ? PALETTE.successBorder : PALETTE.infoBorder;
  const color = success ? PALETTE.successText : PALETTE.infoText;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${bg};border:1px solid ${border};border-radius:12px;margin:2px 0 20px 0;">
<tr><td style="padding:14px 18px;font-family:${FONT_BODY};font-size:14px;line-height:22px;color:${color};">
${
  callout.title
    ? `<strong style="display:block;font-weight:700;padding-bottom:3px;">${escapeHtml(
        callout.title,
      )}</strong>`
    : ''
}${escapeHtml(callout.text)}
</td></tr>
</table>`;
}

function ctaHtml(cta: NonNullable<BrandedEmailInput['cta']>): string {
  // Button as a table cell: Outlook drops padding and border-radius on a
  // styled <a>, but honours them on the cell behind it.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 8px 0;">
<tr><td bgcolor="${PALETTE.brand}" style="background-color:${
    PALETTE.brand
  };border-radius:10px;">
<a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:13px 28px;font-family:${FONT_BODY};font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(
    cta.label,
  )}</a>
</td></tr>
</table>
<div style="font-family:${FONT_BODY};font-size:12px;line-height:19px;color:${
    PALETTE.textSubtle
  };padding:6px 0 4px 0;word-break:break-all;">Or paste this link into your browser: ${escapeHtml(
    cta.url,
  )}</div>`;
}

function signOffHtml(signOff: string): string {
  return `<p style="margin:18px 0 0 0;padding-top:18px;border-top:1px solid ${
    PALETTE.border
  };font-family:${FONT_BODY};font-size:14px;line-height:23px;color:${
    PALETTE.textMuted
  };">${escapeHtml(signOff)}</p>`;
}

/**
 * Plain-text twin of the HTML, built from the same input so the two parts can
 * never drift. Sent as the `text` MIME part, and reused as the notification
 * `body` that the provider logs.
 */
function renderText(input: BrandedEmailInput): string {
  const blocks: string[] = [input.heading, ''];

  if (input.lead) blocks.push(input.lead, '');
  for (const paragraph of input.paragraphs ?? []) blocks.push(paragraph, '');

  if (input.facts?.length) {
    if (input.factsTitle) blocks.push(`${input.factsTitle}:`);
    const width = Math.max(...input.facts.map((f) => f.label.length));
    for (const fact of input.facts) {
      blocks.push(`  ${fact.label.padEnd(width)}  ${fact.value}`);
    }
    blocks.push('');
  }

  if (input.callout) {
    blocks.push(
      input.callout.title
        ? `${input.callout.title}: ${input.callout.text}`
        : input.callout.text,
      '',
    );
  }

  if (input.cta) blocks.push(`${input.cta.label}: ${input.cta.url}`, '');
  if (input.signOff) blocks.push(input.signOff, '');
  if (input.footerNote) blocks.push('--', input.footerNote);

  return blocks
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}
