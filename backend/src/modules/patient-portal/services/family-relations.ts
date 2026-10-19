/**
 * Relationship labels as the family tree draws them.
 *
 * A connection stores the label from the person who sent the invite
 * ("Spouse", "Son"). The other person, and anyone already on that
 * person's tree, needs the label from their own side.
 */

export type FamilyRole = 'parent' | 'spouse' | 'child' | 'sibling' | 'other';

export function familyRole(label?: string): FamilyRole {
  const r = (label ?? '')
    .toLowerCase()
    .replace(' (dependant)', '')
    .trim();
  if (r === 'mother' || r === 'father' || r === 'parent') return 'parent';
  if (r === 'husband' || r === 'wife' || r === 'spouse' || r === 'partner')
    return 'spouse';
  if (r === 'son' || r === 'daughter' || r === 'child') return 'child';
  if (r === 'brother' || r === 'sister' || r === 'sibling') return 'sibling';
  return 'other';
}

export function inverseFamilyRole(role: FamilyRole): FamilyRole {
  if (role === 'parent') return 'child';
  if (role === 'child') return 'parent';
  return role;
}

/** "Son" stays "Son". A bare role is filled in from gender so the tree can place it. */
export function displayRelation(
  role: FamilyRole,
  original: string | undefined,
  gender?: string,
): string {
  const raw = (original ?? '').replace(/ \(dependant\)/i, '').trim();
  if (raw && familyRole(raw) === role && familyRole(raw) !== 'other') {
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  const male = gender === 'MALE';
  const female = gender === 'FEMALE';
  switch (role) {
    case 'parent':
      return male ? 'Father' : female ? 'Mother' : 'Parent';
    case 'spouse':
      return male ? 'Husband' : female ? 'Wife' : 'Spouse';
    case 'child':
      return male ? 'Son' : female ? 'Daughter' : 'Child';
    case 'sibling':
      return male ? 'Brother' : female ? 'Sister' : 'Sibling';
    default:
      return 'Family';
  }
}

/**
 * `member` is on the connector's tree. Return how the viewer should
 * label them, or null when the member is the viewer themselves.
 */
export function composedFamilyRole(
  howViewerSeesConnector: FamilyRole,
  howConnectorSeesMember: FamilyRole,
): FamilyRole | null {
  switch (howViewerSeesConnector) {
    case 'spouse':
      if (howConnectorSeesMember === 'spouse') return null;
      if (
        howConnectorSeesMember === 'child' ||
        howConnectorSeesMember === 'parent' ||
        howConnectorSeesMember === 'sibling'
      )
        return howConnectorSeesMember;
      return 'other';
    case 'child':
      // The viewer is the connector's parent.
      if (howConnectorSeesMember === 'parent') return 'spouse';
      if (howConnectorSeesMember === 'sibling') return 'child';
      return 'other';
    case 'parent':
      // The viewer is the connector's child.
      if (howConnectorSeesMember === 'spouse') return 'parent';
      if (howConnectorSeesMember === 'child') return 'sibling';
      return 'other';
    case 'sibling':
      if (howConnectorSeesMember === 'parent') return 'parent';
      if (howConnectorSeesMember === 'sibling') return 'sibling';
      return 'other';
    default:
      return 'other';
  }
}
