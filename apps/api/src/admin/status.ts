export const USER_STATUSES = ['active', 'suspended', 'banned'] as const;
export const REALTOR_STATUSES = [
  'active',
  'suspended',
  'banned',
  'pending',
] as const;
export const AGENCY_STATUSES = ['active', 'pending', 'suspended'] as const;
export const LISTING_STATUSES = [
  'active',
  'inactive',
  'draft',
  'archived',
  'suspended',
] as const;
export const EXTERNAL_LISTING_STATUSES = [
  'new',
  'ingested',
  'deduped',
  'rejected',
  'archived',
] as const;
export const REQUEST_STATUSES = [
  'open',
  'matched',
  'closed',
  'cancelled',
  'expired',
] as const;

export type EntityStatusMap = Record<string, readonly string[]>;

// Keyed by the admin set*Status entity name.
export const ENTITY_STATUSES: EntityStatusMap = {
  user: USER_STATUSES,
  realtor: REALTOR_STATUSES,
  agency: AGENCY_STATUSES,
  listing: LISTING_STATUSES,
  external_listing: EXTERNAL_LISTING_STATUSES,
  request: REQUEST_STATUSES,
};

export function isAllowedStatus(entity: string, status: string): boolean {
  const allowed = ENTITY_STATUSES[entity];
  if (allowed === undefined) {
    return false;
  }
  return (allowed as readonly string[]).includes(status);
}
