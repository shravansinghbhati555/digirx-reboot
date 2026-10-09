import { parseRecipientList } from './recipients';

/**
 * This parses a value a human typed into .env, so the tests are mostly about
 * the ways that value comes out messy: a trailing comma, a pasted list with
 * spaces, the same address twice.
 */
describe('parseRecipientList', () => {
  it('reads a single address', () => {
    expect(parseRecipientList('info@digirx.online')).toEqual(['info@digirx.online']);
  });

  it('splits a comma-separated list', () => {
    expect(parseRecipientList('info@digirx.online,raj@vidhema.com')).toEqual([
      'info@digirx.online',
      'raj@vidhema.com',
    ]);
  });

  it('tolerates spaces, semicolons and a trailing separator', () => {
    expect(parseRecipientList(' info@digirx.online ; raj@vidhema.com, ')).toEqual([
      'info@digirx.online',
      'raj@vidhema.com',
    ]);
  });

  it('drops a repeated address, whatever its case', () => {
    expect(parseRecipientList('Info@DigiRx.online,info@digirx.online')).toEqual([
      'Info@DigiRx.online',
    ]);
  });

  it('skips entries that are not addresses', () => {
    expect(parseRecipientList('info@digirx.online,not-an-address')).toEqual([
      'info@digirx.online',
    ]);
  });

  it('returns nothing for unset or empty values', () => {
    expect(parseRecipientList(undefined)).toEqual([]);
    expect(parseRecipientList('   ')).toEqual([]);
  });
});
