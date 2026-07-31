create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists phone text;

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

alter table public.properties add column if not exists agency_id uuid references public.agencies(id) on delete set null;
alter table public.properties add column if not exists listing_type text not null default 'sale';
alter table public.properties add column if not exists district text;
alter table public.properties add column if not exists address text;
alter table public.properties add column if not exists latitude numeric;
alter table public.properties add column if not exists longitude numeric;
alter table public.properties add column if not exists area numeric;
alter table public.properties add column if not exists rooms integer;
alter table public.properties add column if not exists floor integer;
alter table public.properties add column if not exists total_floors integer;
alter table public.properties add column if not exists property_condition text;
alter table public.properties add column if not exists contact_phone text;

create table if not exists public.property_features (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  feature_name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(property_id, feature_name)
);

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, property_id)
);

create table if not exists public.property_views (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  viewer_id uuid references public.users(id) on delete set null,
  ip_address text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete set null,
  buyer_id uuid not null references public.users(id) on delete cascade,
  seller_id uuid not null references public.users(id) on delete cascade,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

create index if not exists idx_agencies_owner_id on public.agencies (owner_id);
create index if not exists idx_agencies_deleted_at on public.agencies (deleted_at);
create index if not exists idx_agency_members_agency_id on public.agency_members (agency_id);
create index if not exists idx_agency_members_user_id on public.agency_members (user_id);
create index if not exists idx_properties_agency_id on public.properties (agency_id);
create index if not exists idx_properties_listing_type on public.properties (listing_type);
create index if not exists idx_property_features_property_id on public.property_features (property_id);
create index if not exists idx_favorites_user_id on public.favorites (user_id);
create index if not exists idx_favorites_property_id on public.favorites (property_id);
create index if not exists idx_property_views_property_id on public.property_views (property_id);
create index if not exists idx_conversations_buyer_id on public.conversations (buyer_id);
create index if not exists idx_conversations_seller_id on public.conversations (seller_id);
create index if not exists idx_messages_conversation_id on public.messages (conversation_id);
create index if not exists idx_notifications_user_id on public.notifications (user_id);
create index if not exists idx_notifications_unread on public.notifications (user_id, is_read);

create trigger trg_agencies_set_updated_at before insert or update on public.agencies for each row execute function public.set_updated_at();
create trigger trg_agency_members_set_updated_at before insert or update on public.agency_members for each row execute function public.set_updated_at();
create trigger trg_property_features_set_updated_at before insert or update on public.property_features for each row execute function public.set_updated_at();
create trigger trg_favorites_set_updated_at before insert or update on public.favorites for each row execute function public.set_updated_at();
create trigger trg_property_views_set_updated_at before insert or update on public.property_views for each row execute function public.set_updated_at();
create trigger trg_conversations_set_updated_at before insert or update on public.conversations for each row execute function public.set_updated_at();
create trigger trg_messages_set_updated_at before insert or update on public.messages for each row execute function public.set_updated_at();
create trigger trg_notifications_set_updated_at before insert or update on public.notifications for each row execute function public.set_updated_at();

alter table public.agencies enable row level security;
alter table public.agency_members enable row level security;
alter table public.property_features enable row level security;
alter table public.favorites enable row level security;
alter table public.property_views enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;

create policy "Agency owners and members can view agencies" on public.agencies for select to authenticated using (exists (select 1 from public.agency_members am where am.agency_id = id and am.user_id = auth.uid() and am.is_active = true and am.deleted_at is null) or owner_id = auth.uid());
create policy "Users can create agencies" on public.agencies for insert to authenticated with check (owner_id = auth.uid());
create policy "Agency owners can update agencies" on public.agencies for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Service role can manage agencies" on public.agencies for all to service_role using (true) with check (true);

create policy "Agency members can view membership" on public.agency_members for select to authenticated using (exists (select 1 from public.agency_members am where am.agency_id = agency_members.agency_id and am.user_id = auth.uid() and am.is_active = true and am.deleted_at is null) or exists (select 1 from public.agencies a where a.id = agency_members.agency_id and a.owner_id = auth.uid()));
create policy "Agency owners can manage membership" on public.agency_members for all to authenticated using (exists (select 1 from public.agencies a where a.id = agency_members.agency_id and a.owner_id = auth.uid())) with check (exists (select 1 from public.agencies a where a.id = agency_members.agency_id and a.owner_id = auth.uid()));
create policy "Service role can manage agency members" on public.agency_members for all to service_role using (true) with check (true);

create policy "Public property features are viewable" on public.property_features for select to anon using (exists (select 1 from public.properties p where p.id = property_id and p.is_public = true and p.deleted_at is null) and deleted_at is null);
create policy "Owners can manage property features" on public.property_features for all to authenticated using (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid() and p.deleted_at is null)) with check (exists (select 1 from public.properties p where p.id = property_id and p.owner_id = auth.uid() and p.deleted_at is null));
create policy "Service role can manage property features" on public.property_features for all to service_role using (true) with check (true);

create policy "Authenticated users can manage favorites" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Service role can manage favorites" on public.favorites for all to service_role using (true) with check (true);

create policy "Authenticated users can view property views" on public.property_views for select to authenticated using (true);
create policy "Authenticated users can create property views" on public.property_views for insert to authenticated with check (true);
create policy "Service role can manage property views" on public.property_views for all to service_role using (true) with check (true);

create policy "Users can view their conversations" on public.conversations for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());
create policy "Users can create conversations" on public.conversations for insert to authenticated with check (buyer_id = auth.uid() or seller_id = auth.uid());
create policy "Service role can manage conversations" on public.conversations for all to service_role using (true) with check (true);

create policy "Users can view their messages" on public.messages for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())));
create policy "Users can create messages" on public.messages for insert to authenticated with check (exists (select 1 from public.conversations c where c.id = conversation_id and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())) and sender_id = auth.uid());
create policy "Service role can manage messages" on public.messages for all to service_role using (true) with check (true);

create policy "Users can view their notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "Users can update their notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Service role can manage notifications" on public.notifications for all to service_role using (true) with check (true);
