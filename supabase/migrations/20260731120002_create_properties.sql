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
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_properties_owner_id on public.properties (owner_id);
create index if not exists idx_properties_public_deleted on public.properties (is_public, deleted_at);
create index if not exists idx_properties_city on public.properties (city);

create trigger trg_properties_set_updated_at
before insert or update on public.properties
for each row execute function public.set_updated_at();

alter table public.properties enable row level security;

create policy "Public properties are viewable"
on public.properties
for select
to anon
using (is_public = true and deleted_at is null);

create policy "Authenticated users can view their own properties"
on public.properties
for select
to authenticated
using (owner_id = auth.uid() and deleted_at is null);

create policy "Users can create their own properties"
on public.properties
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "Users can update their own properties"
on public.properties
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Service role can manage properties"
on public.properties
for all
to service_role
using (true)
with check (true);
