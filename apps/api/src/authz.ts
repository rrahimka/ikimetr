export type AgencyRole = 'owner' | 'admin' | 'member';
export type MembershipStatus = 'active' | 'invited' | 'removed';

export interface AgencyMembership {
  agencyId: string;
  userId: string;
  role: AgencyRole;
  status: MembershipStatus;
}

const ROLE_ORDER: Record<AgencyRole, number> = {
  member: 0,
  admin: 1,
  owner: 2,
};

/**
 * Server-side check: is `membership` sufficient to act with at least `minimumRole`?
 * Only active memberships grant authority.
 */
export function canManageAgency(
  membership: AgencyMembership | null,
  minimumRole: AgencyRole = 'admin',
): boolean {
  if (membership === null || membership.status !== 'active') {
    return false;
  }

  return ROLE_ORDER[membership.role] >= ROLE_ORDER[minimumRole];
}

export interface PropertyOwnership {
  ownerUserId: string;
  agencyId: string | null;
}

/**
 * Server-side property edit authorization. The authenticated user may edit when:
 * - they are the property owner, or
 * - the property belongs to an agency they are an active member of.
 * Ownership is never derived from client payload.
 */
export function canEditProperty(
  property: PropertyOwnership,
  userId: string,
  membership: AgencyMembership | null,
): boolean {
  if (property.ownerUserId === userId) {
    return true;
  }

  if (
    property.agencyId !== null &&
    membership !== null &&
    membership.agencyId === property.agencyId &&
    membership.status === 'active'
  ) {
    return canManageAgency(membership, 'member');
  }

  return false;
}
