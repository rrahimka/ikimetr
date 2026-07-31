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

create trigger trg_property_images_set_updated_at
before insert or update on public.property_images
for each row execute function public.set_updated_at();

alter table public.property_images enable row level security;

create policy "Public property images are viewable"
on public.property_images
for select
to anon
using (
  exists (
    select 1
    from public.properties p
    where p.id = property_id
      and p.is_public = true
      and p.deleted_at is null
  )
  and deleted_at is null
);

create policy "Owners can manage their property images"
on public.property_images
for all
to authenticated
using (
  exists (
    select 1
    from public.properties p
    where p.id = property_id
      and p.owner_id = auth.uid()
      and p.deleted_at is null
  )
)
with check (
  exists (
    select 1
    from public.properties p
    where p.id = property_id
      and p.owner_id = auth.uid()
      and p.deleted_at is null
  )
);

create policy "Service role can manage property images"
on public.property_images
for all
to service_role
using (true)
with check (true);
