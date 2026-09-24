/**
 * Reads an env var that holds one or more email addresses.
 *
 * Internal inboxes (LEADS_NOTIFY_EMAIL) are written as a comma-separated
 * list, the same shape CORS_ORIGINS uses, so a second person can be added
 * without a second env key to keep in sync:
 *
 *   LEADS_NOTIFY_EMAIL=info@digirx.online,raj.baptla@vidhema.com
 *
 * Semicolons and whitespace also separate, because that is how addresses
 * arrive when someone copies them out of a mail client. Duplicates are
 * dropped case-insensitively so a repeated address is not mailed twice.
 *
 * Callers send one message per address rather than putting the whole list in
 * a single `to`: SendGrid treats a comma-joined string as one malformed
 * address, and one bad entry should not cost everyone else the mail.
 */
export function parseRecipientList(raw: string | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const part of raw.split(/[,;\s]+/)) {
    const address = part.trim();
    // Not full validation — just enough to skip stray text like a trailing
    // comma or a quoted display name that would bounce anyway.
    if (!address.includes('@')) continue;

    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(address);
  }

  return out;
}
