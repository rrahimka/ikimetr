// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const tables = [
    'users',
    'user_profiles',
    'agencies',
    'agency_members',
    'properties',
    'property_images',
    'property_features',
    'favorites',
    'property_views',
    'conversations',
    'messages',
    'notifications',
  ];

  const { data, error } = await supabase.rpc('pg_tables', { schemaname: 'public' });
  if (error) {
    console.error('Unable to query database metadata:', error.message);
    process.exit(1);
  }

  const existing = new Set((data || []).map((row) => row.tablename));
  const missing = tables.filter((table) => !existing.has(table));

  if (missing.length) {
    console.log('Missing tables:', missing.join(', '));
    process.exit(1);
  }

  console.log('All target tables exist:', tables.join(', '));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
