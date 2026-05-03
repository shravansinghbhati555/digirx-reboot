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
