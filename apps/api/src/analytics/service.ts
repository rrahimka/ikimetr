import type { DatabaseConnection } from '@ikimetr/database';

export interface PlatformAnalytics {
  counts: {
    users: number;
    realtors: number;
    agencies: number;
    listings: number;
    activeListings: number;
    requests: number;
    matches: number;
    subscriptions: number;
    activeSubscriptions: number;
  };
  listingsByDistrict: { district: string; count: number }[];
  subscriptionsByPlan: { planCode: string; count: number }[];
  sourceHealth: { sourceStatus: string; count: number }[];
  recentActivity: {
    newListingsLast7d: number;
    newUsersLast7d: number;
    newRequestsLast7d: number;
  };
}

export async function getPlatformAnalytics(
  db: DatabaseConnection,
): Promise<PlatformAnalytics> {
  return db.transaction(async (tx) => {
    const counts = await tx.query<{
      users: string;
      realtors: string;
      agencies: string;
      listings: string;
      active_listings: string;
      requests: string;
      matches: string;
      subscriptions: string;
      active_subscriptions: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.users) AS users,
         (SELECT count(*) FROM app.realtor_profiles) AS realtors,
         (SELECT count(*) FROM app.agencies) AS agencies,
         (SELECT count(*) FROM app.listings) AS listings,
         (SELECT count(*) FROM app.listings WHERE status = 'active') AS active_listings,
         (SELECT count(*) FROM app.client_requests) AS requests,
         (SELECT count(*) FROM app.request_matches) AS matches,
         (SELECT count(*) FROM app.subscriptions) AS subscriptions,
         (SELECT count(*) FROM app.subscriptions WHERE status = 'active') AS active_subscriptions`,
    );
    const byDistrict = await tx.query<{
      district: string | null;
      count: string;
    }>(
      `SELECT district, count(*)::text AS count
       FROM app.listings
       WHERE district IS NOT NULL
       GROUP BY district ORDER BY count DESC LIMIT 20`,
    );
    const byPlan = await tx.query<{ plan_code: string; count: string }>(
      `SELECT p.code AS plan_code, count(*)::text AS count
       FROM app.subscriptions s
       JOIN app.plans p ON p.id = s.plan_id
       GROUP BY p.code`,
    );
    const sourceHealth = await tx.query<{
      source_status: string | null;
      count: string;
    }>(
      `SELECT source_status, count(*)::text AS count
       FROM app.external_listings
       GROUP BY source_status`,
    );
    const recent = await tx.query<{
      new_listings: string;
      new_users: string;
      new_requests: string;
    }>(
      `SELECT
         (SELECT count(*) FROM app.listings WHERE created_at > now() - interval '7 days') AS new_listings,
         (SELECT count(*) FROM app.users WHERE created_at > now() - interval '7 days') AS new_users,
         (SELECT count(*) FROM app.client_requests WHERE created_at > now() - interval '7 days') AS new_requests`,
    );

    const c = counts.rows[0]!;
    const r = recent.rows[0]!;
    return {
      counts: {
        users: Number(c.users),
        realtors: Number(c.realtors),
        agencies: Number(c.agencies),
        listings: Number(c.listings),
        activeListings: Number(c.active_listings),
        requests: Number(c.requests),
        matches: Number(c.matches),
        subscriptions: Number(c.subscriptions),
        activeSubscriptions: Number(c.active_subscriptions),
      },
      listingsByDistrict: byDistrict.rows.map((row) => ({
        district: row.district ?? 'unknown',
        count: Number(row.count),
      })),
      subscriptionsByPlan: byPlan.rows.map((row) => ({
        planCode: row.plan_code,
        count: Number(row.count),
      })),
      sourceHealth: sourceHealth.rows.map((row) => ({
        sourceStatus: row.source_status ?? 'unknown',
        count: Number(row.count),
      })),
      recentActivity: {
        newListingsLast7d: Number(r.new_listings),
        newUsersLast7d: Number(r.new_users),
        newRequestsLast7d: Number(r.new_requests),
      },
    };
  });
}
