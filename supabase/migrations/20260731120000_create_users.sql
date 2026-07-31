create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_deleted_at on public.users (deleted_at);
create index if not exists idx_users_is_active on public.users (is_active);

create trigger trg_users_set_updated_at
before insert or update on public.users
for each row execute function public.set_updated_at();

alter table public.users enable row level security;

create policy "Users can view their own record"
on public.users
for select
to authenticated
using (auth.uid() = id and deleted_at is null);

create policy "Users can insert their own record"
on public.users
for insert
to authenticated
with check (auth.uid() = id);

create policy "Users can update their own record"
on public.users
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Service role can manage users"
on public.users
for all
to service_role
using (true)
with check (true);
