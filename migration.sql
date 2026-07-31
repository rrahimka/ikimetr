-- Consolidated Supabase migration for IkiMetr
-- This script is safe to run in the Supabase SQL Editor.
-- It is idempotent and does not drop existing user data.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Users
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  phone text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_deleted_at on public.users (deleted_at);
create index if not exists idx_users_is_active on public.users (is_active);

drop trigger if exists trg_users_set_updated_at on public.users;
create trigger trg_users_set_updated_at
before insert or update on public.users
for each row execute function public.set_updated_at();

alter table public.users enable row level security;

drop policy if exists "Users can view their own record" on public.users;
create policy "Users can view their own record"
on public.users
for select
to authenticated
using (auth.uid() = id and deleted_at is null);

drop policy if exists "Users can insert their own record" on public.users;
create policy "Users can insert their own record"
on public.users
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "Users can update their own record" on public.users;
create policy "Users can update their own record"
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Service role can manage users" on public.users;
create policy "Service role can manage users"
on public.users
for all
to service_role
using (true)
with check (true);

-- Profiles
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  bio text,
  locale text not null default 'en',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_user_id on public.profiles (user_id);
create index if not exists idx_profiles_deleted_at on public.profiles (deleted_at);

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before insert or update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Service role can manage profiles" on public.profiles;
create policy "Service role can manage profiles"
on public.profiles
for all
to service_role
using (true)
with check (true);

-- Agencies
create table if not exists public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  website text,
  phone text,
  email text,
  owner_id uuid not null references public.users(id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agencies_owner_id on public.agencies (owner_id);
create index if not exists idx_agencies_deleted_at on public.agencies (deleted_at);

drop trigger if exists trg_agencies_set_updated_at on public.agencies;
create trigger trg_agencies_set_updated_at
before insert or update on public.agencies
for each row execute function public.set_updated_at();

alter table public.agencies enable row level security;

drop policy if exists "Agency owners and members can view agencies" on public.agencies;
create policy "Agency owners and members can view agencies"
on public.agencies
for select
to authenticated
using (
  exists (
    select 1
    from public.agency_members am
    where am.agency_id = public.agencies.id
      and am.user_id = auth.uid()
      and am.is_active = true
      and am.deleted_at is null
  )
  or owner_id = auth.uid()
);

drop policy if exists "Users can create agencies" on public.agencies;
create policy "Users can create agencies"
on public.agencies
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Agency owners can update agencies" on public.agencies;
create policy "Agency owners can update agencies"
on public.agencies
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Service role can manage agencies" on public.agencies;
create policy "Service role can manage agencies"
on public.agencies
for all
to service_role
using (true)
with check (true);

-- Agency members
create table if not exists public.agency_members (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member',
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agency_id, user_id)
);

create index if not exists idx_agency_members_agency_id on public.agency_members (agency_id);
create index if not exists idx_agency_members_user_id on public.agency_members (user_id);

drop trigger if exists trg_agency_members_set_updated_at on public.agency_members;
create trigger trg_agency_members_set_updated_at
before insert or update on public.agency_members
for each row execute function public.set_updated_at();

alter table public.agency_members enable row level security;

drop policy if exists "Agency members can view membership" on public.agency_members;
create policy "Agency members can view membership"
on public.agency_members
for select
to authenticated
using (
  exists (
    select 1
    from public.agency_members am
    where am.agency_id = public.agency_members.agency_id
      and am.user_id = auth.uid()
      and am.is_active = true
      and am.deleted_at is null
  )
  or exists (
    select 1
    from public.agencies a
    where a.id = public.agency_members.agency_id
      and a.owner_id = auth.uid()
  )
);

drop policy if exists "Agency owners can manage membership" on public.agency_members;
create policy "Agency owners can manage membership"
on public.agency_members
for all
to authenticated
using (
  exists (
    select 1
    from public.agencies a
    where a.id = public.agency_members.agency_id
      and a.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.agencies a
    where a.id = public.agency_members.agency_id
      and a.owner_id = auth.uid()
  )
);

drop policy if exists "Service role can manage agency members" on public.agency_members;
create policy "Service role can manage agency members"
on public.agency_members
for all
to service_role
using (true)
with check (true);

-- Properties
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  price numeric(12,2),
  currency text not null default 'USD',
  bedrooms integer,
  bathrooms integer,
  square_feet integer,
  property_type text not null default 'other',
  is_public boolean not null default false,
  agency_id uuid references public.agencies(id) on delete set null,
  listing_type text not null default 'sale',
  district text,
  address text,
  latitude numeric,
  longitude numeric,
  area numeric,
  rooms integer,
  floor integer,
  total_floors integer,
  property_condition text,
  contact_phone text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_properties_owner_id on public.properties (owner_id);
create index if not exists idx_properties_agency_id on public.properties (agency_id);
create index if not exists idx_properties_public_deleted on public.properties (is_public, deleted_at);
create index if not exists idx_properties_city on public.properties (city);
create index if not exists idx_properties_listing_type on public.properties (listing_type);

drop trigger if exists trg_properties_set_updated_at on public.properties;
create trigger trg_properties_set_updated_at
before insert or update on public.properties
for each row execute function public.set_updated_at();

alter table public.properties enable row level security;

drop policy if exists "Public properties are viewable" on public.properties;
create policy "Public properties are viewable"
on public.properties
for select
to anon
using (is_public = true and deleted_at is null);

drop policy if exists "Authenticated users can view their own properties" on public.properties;
create policy "Authenticated users can view their own properties"
on public.properties
for select
to authenticated
using (owner_id = auth.uid() and deleted_at is null);

drop policy if exists "Users can create their own properties" on public.properties;
create policy "Users can create their own properties"
on public.properties
for insert
to authenticated
with check (owner_id = auth.uid());

drop policy if exists "Users can update their own properties" on public.properties;
create policy "Users can update their own properties"
on public.properties
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "Service role can manage properties" on public.properties;
create policy "Service role can manage properties"
on public.properties
for all
to service_role
using (true)
with check (true);

-- Property images
create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  caption text,
  is_primary boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_images_property_id on public.property_images (property_id);
create index if not exists idx_property_images_primary on public.property_images (is_primary, deleted_at);

drop trigger if exists trg_property_images_set_updated_at on public.property_images;
create trigger trg_property_images_set_updated_at
before insert or update on public.property_images
for each row execute function public.set_updated_at();

alter table public.property_images enable row level security;

drop policy if exists "Public property images are viewable" on public.property_images;
create policy "Public property images are viewable"
on public.property_images
for select
to anon
using (
  exists (
    select 1
    from public.properties p
    where p.id = public.property_images.property_id
      and p.is_public = true
      and p.deleted_at is null
  )
  and deleted_at is null
);

drop policy if exists "Owners can manage their property images" on public.property_images;
create policy "Owners can manage their property images"
on public.property_images
for all
to authenticated
using (
  exists (
    select 1
    from public.properties p
    where p.id = public.property_images.property_id
      and p.owner_id = auth.uid()
      and p.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from public.properties p
    where p.id = public.property_images.property_id
      and p.owner_id = auth.uid()
      and p.deleted_at is null
  )
);

drop policy if exists "Service role can manage property images" on public.property_images;
create policy "Service role can manage property images"
on public.property_images
for all
to service_role
using (true)
with check (true);

-- Property features
create table if not exists public.property_features (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  feature_name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, feature_name)
);

create index if not exists idx_property_features_property_id on public.property_features (property_id);

drop trigger if exists trg_property_features_set_updated_at on public.property_features;
create trigger trg_property_features_set_updated_at
before insert or update on public.property_features
for each row execute function public.set_updated_at();

alter table public.property_features enable row level security;

drop policy if exists "Public property features are viewable" on public.property_features;
create policy "Public property features are viewable"
on public.property_features
for select
to anon
using (
  exists (
    select 1
    from public.properties p
    where p.id = public.property_features.property_id
      and p.is_public = true
      and p.deleted_at is null
  )
  and deleted_at is null
);

drop policy if exists "Owners can manage property features" on public.property_features;
create policy "Owners can manage property features"
on public.property_features
for all
to authenticated
using (
  exists (
    select 1
    from public.properties p
    where p.id = public.property_features.property_id
      and p.owner_id = auth.uid()
      and p.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from public.properties p
    where p.id = public.property_features.property_id
      and p.owner_id = auth.uid()
      and p.deleted_at is null
  )
);

drop policy if exists "Service role can manage property features" on public.property_features;
create policy "Service role can manage property features"
on public.property_features
for all
to service_role
using (true)
with check (true);

-- Favorites
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, property_id)
);

create index if not exists idx_favorites_user_id on public.favorites (user_id);
create index if not exists idx_favorites_property_id on public.favorites (property_id);

drop trigger if exists trg_favorites_set_updated_at on public.favorites;
create trigger trg_favorites_set_updated_at
before insert or update on public.favorites
for each row execute function public.set_updated_at();

alter table public.favorites enable row level security;

drop policy if exists "Authenticated users can manage favorites" on public.favorites;
create policy "Authenticated users can manage favorites"
on public.favorites
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Service role can manage favorites" on public.favorites;
create policy "Service role can manage favorites"
on public.favorites
for all
to service_role
using (true)
with check (true);

-- Property views
create table if not exists public.property_views (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  viewer_id uuid references public.users(id) on delete set null,
  ip_address text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_property_views_property_id on public.property_views (property_id);

drop trigger if exists trg_property_views_set_updated_at on public.property_views;
create trigger trg_property_views_set_updated_at
before insert or update on public.property_views
for each row execute function public.set_updated_at();

alter table public.property_views enable row level security;

drop policy if exists "Authenticated users can view property views" on public.property_views;
create policy "Authenticated users can view property views"
on public.property_views
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can create property views" on public.property_views;
create policy "Authenticated users can create property views"
on public.property_views
for insert
to authenticated
with check (true);

drop policy if exists "Service role can manage property views" on public.property_views;
create policy "Service role can manage property views"
on public.property_views
for all
to service_role
using (true)
with check (true);

-- Conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  buyer_id uuid not null references public.users(id) on delete cascade,
  seller_id uuid not null references public.users(id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_buyer_id on public.conversations (buyer_id);
create index if not exists idx_conversations_seller_id on public.conversations (seller_id);

drop trigger if exists trg_conversations_set_updated_at on public.conversations;
create trigger trg_conversations_set_updated_at
before insert or update on public.conversations
for each row execute function public.set_updated_at();

alter table public.conversations enable row level security;

drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations"
on public.conversations
for select
to authenticated
using (buyer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists "Users can create conversations" on public.conversations;
create policy "Users can create conversations"
on public.conversations
for insert
to authenticated
with check (buyer_id = auth.uid() or seller_id = auth.uid());

drop policy if exists "Service role can manage conversations" on public.conversations;
create policy "Service role can manage conversations"
on public.conversations
for all
to service_role
using (true)
with check (true);

-- Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_messages_conversation_id on public.messages (conversation_id);

drop trigger if exists trg_messages_set_updated_at on public.messages;
create trigger trg_messages_set_updated_at
before insert or update on public.messages
for each row execute function public.set_updated_at();

alter table public.messages enable row level security;

drop policy if exists "Users can view their messages" on public.messages;
create policy "Users can view their messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
);

drop policy if exists "Users can create messages" on public.messages;
create policy "Users can create messages"
on public.messages
for insert
to authenticated
with check (
  exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
  and sender_id = auth.uid()
);

drop policy if exists "Service role can manage messages" on public.messages;
create policy "Service role can manage messages"
on public.messages
for all
to service_role
using (true)
with check (true);

-- Notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text,
  is_read boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_id on public.notifications (user_id);
create index if not exists idx_notifications_unread on public.notifications (user_id, is_read);

drop trigger if exists trg_notifications_set_updated_at on public.notifications;
create trigger trg_notifications_set_updated_at
before insert or update on public.notifications
for each row execute function public.set_updated_at();

alter table public.notifications enable row level security;

drop policy if exists "Users can view their notifications" on public.notifications;
create policy "Users can view their notifications"
on public.notifications
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Service role can manage notifications" on public.notifications;
create policy "Service role can manage notifications"
on public.notifications
for all
to service_role
using (true)
with check (true);
