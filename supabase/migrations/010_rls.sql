-- RLS enablement and policies
alter table public.users enable row level security;
drop policy if exists "Users can view their own record" on public.users;
create policy "Users can view their own record" on public.users for select to authenticated using (auth.uid() = id and deleted_at is null);
drop policy if exists "Users can insert their own record" on public.users;
create policy "Users can insert their own record" on public.users for insert to authenticated with check (auth.uid() = id);
drop policy if exists "Users can update their own record" on public.users;
create policy "Users can update their own record" on public.users for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "Service role can manage users" on public.users;
create policy "Service role can manage users" on public.users for all to service_role using (true) with check (true);

alter table public.profiles enable row level security;
drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile" on public.profiles for select to authenticated using (auth.uid() = user_id and deleted_at is null);
drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile" on public.profiles for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Service role can manage profiles" on public.profiles;
create policy "Service role can manage profiles" on public.profiles for all to service_role using (true) with check (true);

alter table public.agencies enable row level security;
drop policy if exists "Agency owners and members can view agencies" on public.agencies;
create policy "Agency owners and members can view agencies" on public.agencies for select to authenticated using (
  exists (select 1 from public.agency_members am where am.agency_id = public.agencies.id and am.user_id = auth.uid() and am.is_active = true and am.deleted_at is null)
  or owner_id = auth.uid()
);
drop policy if exists "Users can create agencies" on public.agencies;
create policy "Users can create agencies" on public.agencies for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Agency owners can update agencies" on public.agencies;
create policy "Agency owners can update agencies" on public.agencies for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Service role can manage agencies" on public.agencies;
create policy "Service role can manage agencies" on public.agencies for all to service_role using (true) with check (true);

alter table public.agency_members enable row level security;
drop policy if exists "Agency members can view membership" on public.agency_members;
create policy "Agency members can view membership" on public.agency_members for select to authenticated using (
  exists (select 1 from public.agency_members am where am.agency_id = public.agency_members.agency_id and am.user_id = auth.uid() and am.is_active = true and am.deleted_at is null)
  or exists (select 1 from public.agencies a where a.id = public.agency_members.agency_id and a.owner_id = auth.uid())
);
drop policy if exists "Agency owners can manage membership" on public.agency_members;
create policy "Agency owners can manage membership" on public.agency_members for all to authenticated using (
  exists (select 1 from public.agencies a where a.id = public.agency_members.agency_id and a.owner_id = auth.uid())
) with check (
  exists (select 1 from public.agencies a where a.id = public.agency_members.agency_id and a.owner_id = auth.uid())
);
drop policy if exists "Service role can manage agency members" on public.agency_members;
create policy "Service role can manage agency members" on public.agency_members for all to service_role using (true) with check (true);

alter table public.properties enable row level security;
drop policy if exists "Public properties are viewable" on public.properties;
create policy "Public properties are viewable" on public.properties for select to anon using (is_public = true and deleted_at is null);
drop policy if exists "Authenticated users can view their own properties" on public.properties;
create policy "Authenticated users can view their own properties" on public.properties for select to authenticated using (owner_id = auth.uid() and deleted_at is null);
drop policy if exists "Users can create their own properties" on public.properties;
create policy "Users can create their own properties" on public.properties for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists "Users can update their own properties" on public.properties;
create policy "Users can update their own properties" on public.properties for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "Service role can manage properties" on public.properties;
create policy "Service role can manage properties" on public.properties for all to service_role using (true) with check (true);

alter table public.property_images enable row level security;
drop policy if exists "Public property images are viewable" on public.property_images;
create policy "Public property images are viewable" on public.property_images for select to anon using (
  exists (select 1 from public.properties p where p.id = public.property_images.property_id and p.is_public = true and p.deleted_at is null)
  and deleted_at is null
);
drop policy if exists "Owners can manage their property images" on public.property_images;
create policy "Owners can manage their property images" on public.property_images for all to authenticated using (
  exists (select 1 from public.properties p where p.id = public.property_images.property_id and p.owner_id = auth.uid() and p.deleted_at is null)
) with check (
  exists (select 1 from public.properties p where p.id = public.property_images.property_id and p.owner_id = auth.uid() and p.deleted_at is null)
);
drop policy if exists "Service role can manage property images" on public.property_images;
create policy "Service role can manage property images" on public.property_images for all to service_role using (true) with check (true);

alter table public.property_features enable row level security;
drop policy if exists "Public property features are viewable" on public.property_features;
create policy "Public property features are viewable" on public.property_features for select to anon using (
  exists (select 1 from public.properties p where p.id = public.property_features.property_id and p.is_public = true and p.deleted_at is null)
  and deleted_at is null
);
drop policy if exists "Owners can manage property features" on public.property_features;
create policy "Owners can manage property features" on public.property_features for all to authenticated using (
  exists (select 1 from public.properties p where p.id = public.property_features.property_id and p.owner_id = auth.uid() and p.deleted_at is null)
) with check (
  exists (select 1 from public.properties p where p.id = public.property_features.property_id and p.owner_id = auth.uid() and p.deleted_at is null)
);
drop policy if exists "Service role can manage property features" on public.property_features;
create policy "Service role can manage property features" on public.property_features for all to service_role using (true) with check (true);

alter table public.favorites enable row level security;
drop policy if exists "Authenticated users can manage favorites" on public.favorites;
create policy "Authenticated users can manage favorites" on public.favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Service role can manage favorites" on public.favorites;
create policy "Service role can manage favorites" on public.favorites for all to service_role using (true) with check (true);

alter table public.property_views enable row level security;
drop policy if exists "Authenticated users can view property views" on public.property_views;
create policy "Authenticated users can view property views" on public.property_views for select to authenticated using (true);
drop policy if exists "Authenticated users can create property views" on public.property_views;
create policy "Authenticated users can create property views" on public.property_views for insert to authenticated with check (true);
drop policy if exists "Service role can manage property views" on public.property_views;
create policy "Service role can manage property views" on public.property_views for all to service_role using (true) with check (true);

alter table public.conversations enable row level security;
drop policy if exists "Users can view their conversations" on public.conversations;
create policy "Users can view their conversations" on public.conversations for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());
drop policy if exists "Users can create conversations" on public.conversations;
create policy "Users can create conversations" on public.conversations for insert to authenticated with check (buyer_id = auth.uid() or seller_id = auth.uid());
drop policy if exists "Service role can manage conversations" on public.conversations;
create policy "Service role can manage conversations" on public.conversations for all to service_role using (true) with check (true);

alter table public.messages enable row level security;
drop policy if exists "Users can view their messages" on public.messages;
create policy "Users can view their messages" on public.messages for select to authenticated using (
  exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
);
drop policy if exists "Users can create messages" on public.messages;
create policy "Users can create messages" on public.messages for insert to authenticated with check (
  exists (
    select 1
    from public.conversations c
    where c.id = public.messages.conversation_id
      and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
  )
  and sender_id = auth.uid()
);
drop policy if exists "Service role can manage messages" on public.messages;
create policy "Service role can manage messages" on public.messages for all to service_role using (true) with check (true);

alter table public.notifications enable row level security;
drop policy if exists "Users can view their notifications" on public.notifications;
create policy "Users can view their notifications" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users can update their notifications" on public.notifications;
create policy "Users can update their notifications" on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Service role can manage notifications" on public.notifications;
create policy "Service role can manage notifications" on public.notifications for all to service_role using (true) with check (true);
