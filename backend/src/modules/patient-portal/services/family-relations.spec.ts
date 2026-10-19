import {
  composedFamilyRole,
  displayRelation,
  familyRole,
  inverseFamilyRole,
} from './family-relations';

describe('family relations', () => {
  it('reads the labels the tree understands', () => {
    expect(familyRole('Mother')).toBe('parent');
    expect(familyRole('Spouse')).toBe('spouse');
    expect(familyRole('Son')).toBe('child');
    expect(familyRole('Brother')).toBe('sibling');
    expect(familyRole('Family')).toBe('other');
  });

  it('turns the inviter’s label around for the person who was invited', () => {
    expect(inverseFamilyRole('parent')).toBe('child');
    expect(inverseFamilyRole('child')).toBe('parent');
    expect(inverseFamilyRole('spouse')).toBe('spouse');
    expect(displayRelation('spouse', undefined, 'MALE')).toBe('Husband');
    expect(displayRelation('child', 'Son', undefined)).toBe('Son');
  });

  it('keeps the inviter’s existing tree on the new member', () => {
    // Invited as a spouse: their son is my son, their mother stays mother.
    expect(composedFamilyRole('spouse', 'child')).toBe('child');
    expect(composedFamilyRole('spouse', 'parent')).toBe('parent');
    expect(composedFamilyRole('spouse', 'spouse')).toBeNull();
    // Invited as a parent: their other children are my siblings, their spouse is my other parent.
    expect(composedFamilyRole('parent', 'child')).toBe('sibling');
    expect(composedFamilyRole('parent', 'spouse')).toBe('parent');
  });
});