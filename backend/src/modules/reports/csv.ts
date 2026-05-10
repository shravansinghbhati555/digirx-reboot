/**
 * Tiny CSV serialiser for report exports. Quotes any cell that contains a
 * comma, quote, or newline. RFC-4180-ish — good enough for Excel / Sheets.
 */
export function toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (!rows.length) return columns ? columns.join(',') + '\n' : '';
  const cols = columns ?? Object.keys(rows[0]);
  const header = cols.join(',');
  const body = rows
    .map((r) => cols.map((c) => quote(r[c])).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

function quote(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s =
    typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
