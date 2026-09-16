/**
 * Formatting shared by every email-capable provider.
 *
 * Notification bodies are plain text because the same string is reused for
 * SMS and WhatsApp. Email needs a subject and an HTML part, and both are
 * derived here so SendGrid and SMTP deliveries look identical.
 */

/**
 * Uses the body's first non-empty line as the subject, trimmed to a sane
 * length. Trailing punctuation is stripped since subjects read better
 * without it.
 */
export function deriveSubject(body: string): string {
  const firstLine = body.split('\n').map((l) => l.trim()).find((l) => l.length) ?? 'Notification';
  const trimmed = firstLine.length > 78 ? `${firstLine.slice(0, 75)}…` : firstLine;
  return trimmed.replace(/[.!?,;:\s]+$/, '');
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Line-broken HTML version of a plain-text body, safe to embed. */
export function toHtmlBody(body: string): string {
  return body
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br/>');
}
