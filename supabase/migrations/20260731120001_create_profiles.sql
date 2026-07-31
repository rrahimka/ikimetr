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

create trigger trg_profiles_set_updated_at
before insert or update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id and deleted_at is null);

create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Service role can manage profiles"
on public.profiles
for all
to service_role
using (true)
with check (true);
