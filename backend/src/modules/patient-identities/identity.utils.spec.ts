import { DateTime } from 'luxon';
import { Types } from 'mongoose';
import {
  ageOn,
  dobMatches,
  maskPhone,
  normalizePortalPhone,
  phoneVariants,
  pickCandidate,
  storedDobIso,
} from './identity.utils';
import { portalEnvErrors, DEFAULT_PORTAL_JWT_SECRET } from './portal-config';

describe('normalizePortalPhone', () => {
  it.each([
    ['+91 98450 12345', '9845012345'],
    ['098450 12345', '9845012345'],
    ['9845012345', '9845012345'],
    ['91-9845012345', '9845012345'],
  ])('%s → %s', (raw, want) => {
    expect(normalizePortalPhone(raw, '91')).toBe(want);
  });

  it('rejects junk', () => {
    expect(normalizePortalPhone('abc', '91')).toBeNull();
    expect(normalizePortalPhone('123', '91')).toBeNull();
  });
});

describe('phoneVariants', () => {
  it('covers the forms a clinic may have stored', () => {
    expect(phoneVariants('9845012345', '91').sort()).toEqual(
      ['09845012345', '919845012345', '9845012345'].sort(),
    );
  });
});

describe('storedDobIso', () => {
  it('reads a UTC-midnight clinic date as that calendar day', () => {
    expect(storedDobIso(new Date('1992-08-14T00:00:00Z'))).toBe('1992-08-14');
  });

  it('reads a clinic-local midnight in the clinic timezone', () => {
    expect(
      storedDobIso(new Date('1992-08-13T18:30:00Z'), 'Asia/Kolkata'),
    ).toBe('1992-08-14');
  });
});

describe('dobMatches', () => {
  it('matches a date stored at UTC midnight', () => {
    expect(dobMatches(new Date('1992-08-14T00:00:00Z'), '1992-08-14')).toBe(
      true,
    );
  });

  it('matches a date stored at clinic-local midnight', () => {
    // 1992-08-14 00:00 in Kolkata is 13 Aug 18:30 UTC.
    expect(
      dobMatches(
        new Date('1992-08-13T18:30:00Z'),
        '1992-08-14',
        'Asia/Kolkata',
      ),
    ).toBe(true);
  });

  it('rejects a different day and a missing DOB', () => {
    expect(
      dobMatches(
        new Date('1992-08-15T00:00:00Z'),
        '1992-08-14',
        'Asia/Kolkata',
      ),
    ).toBe(false);
    expect(dobMatches(undefined, '1992-08-14')).toBe(false);
  });
});

describe('pickCandidate', () => {
  const rec = (name: string) => ({
    _id: new Types.ObjectId(),
    clinicId: 'c',
    fullName: name,
    normalizedName: name.toLowerCase(),
  });

  it('accepts a single match', () => {
    const one = rec('Riya Mehta');
    expect(pickCandidate([one], 'Someone Else')).toBe(one);
  });

  it('uses the name only to break a tie', () => {
    const a = rec('Aarav Mehta');
    const b = rec('Anaya Mehta');
    expect(pickCandidate([a, b], 'Anaya Mehta')).toBe(b);
  });

  it('links nothing when still ambiguous', () => {
    expect(
      pickCandidate([rec('Riya Mehta'), rec('Riya Mehta')], 'Riya Mehta'),
    ).toBeNull();
    expect(pickCandidate([rec('A'), rec('B')], undefined)).toBeNull();
    expect(pickCandidate([], 'A')).toBeNull();
  });
});

describe('ageOn / maskPhone', () => {
  it('computes whole years', () => {
    expect(ageOn('2010-06-01', DateTime.fromISO('2026-05-31'))).toBe(15);
    expect(ageOn('2010-06-01', DateTime.fromISO('2026-06-01'))).toBe(16);
  });

  it('masks all but the last four digits', () => {
    expect(maskPhone('9845012345')).toBe('••••••2345');
  });
});

describe('portalEnvErrors', () => {
  const base = {
    NODE_ENV: 'production',
    PATIENT_PORTAL_ENABLED: 'true',
    JWT_ACCESS_SECRET: 'a'.repeat(40),
  };

  it('is silent when the portal is off', () => {
    expect(portalEnvErrors({ NODE_ENV: 'production' } as any)).toEqual([]);
  });

  it('requires a real, distinct, long secret in production', () => {
    expect(portalEnvErrors({ ...base } as any)).toHaveLength(1);
    expect(
      portalEnvErrors({
        ...base,
        JWT_PORTAL_SECRET: DEFAULT_PORTAL_JWT_SECRET,
      } as any),
    ).toHaveLength(1);
    expect(
      portalEnvErrors({
        ...base,
        JWT_PORTAL_SECRET: base.JWT_ACCESS_SECRET,
      } as any),
    ).toHaveLength(1);
    expect(
      portalEnvErrors({ ...base, JWT_PORTAL_SECRET: 'short' } as any),
    ).toHaveLength(1);
    expect(
      portalEnvErrors({ ...base, JWT_PORTAL_SECRET: 'p'.repeat(40) } as any),
    ).toEqual([]);
  });
});
