export function normalizeName(name: string): string {
  // Strip diacritics so 'José García' is searchable as 'jose garcia'.
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizePhone(phone: string): string {
  // Keep digits only; store last 10 digits to match common local formats.
  const digits = phone.replace(/[^\d]/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Classic Soundex (Russell-Odell, 1918). Cheap, language-agnostic,
 * good enough to bridge "Mehta"/"Mehtaa" and "Saloni"/"Salonee".
 * Returns a 4-char code per word, joined with spaces — multi-word
 * names ("Rajan Mehta") get one code per token so search can match
 * either side independently.
 */
export function phoneticOf(name: string): string {
  const tokens = normalizeName(name).split(/\s+/).filter(Boolean);
  return tokens.map(soundex).join(' ');
}

function soundex(word: string): string {
  if (!word) return '';
  const upper = word.toUpperCase().replace(/[^A-Z]/g, '');
  if (!upper) return '';

  const map: Record<string, string> = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  const first = upper[0];
  let prev = map[first] ?? '';
  let out = first;
  for (let i = 1; i < upper.length && out.length < 4; i++) {
    const code = map[upper[i]] ?? '';
    if (code && code !== prev) out += code;
    if (code) prev = code;
    else if (upper[i] !== 'H' && upper[i] !== 'W') prev = '';
  }
  return (out + '0000').slice(0, 4);
}
