-- Triggers
drop trigger if exists trg_users_set_updated_at on public.users;
create trigger trg_users_set_updated_at
before insert or update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists trg_profiles_set_updated_at on public.profiles;
create trigger trg_profiles_set_updated_at
before insert or update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_agencies_set_updated_at on public.agencies;
create trigger trg_agencies_set_updated_at
before insert or update on public.agencies
for each row execute function public.set_updated_at();

drop trigger if exists trg_agency_members_set_updated_at on public.agency_members;
create trigger trg_agency_members_set_updated_at
before insert or update on public.agency_members
for each row execute function public.set_updated_at();

drop trigger if exists trg_properties_set_updated_at on public.properties;
create trigger trg_properties_set_updated_at
before insert or update on public.properties
for each row execute function public.set_updated_at();

drop trigger if exists trg_property_images_set_updated_at on public.property_images;
create trigger trg_property_images_set_updated_at
before insert or update on public.property_images
for each row execute function public.set_updated_at();

drop trigger if exists trg_property_features_set_updated_at on public.property_features;
create trigger trg_property_features_set_updated_at
before insert or update on public.property_features
for each row execute function public.set_updated_at();

drop trigger if exists trg_favorites_set_updated_at on public.favorites;
create trigger trg_favorites_set_updated_at
before insert or update on public.favorites
for each row execute function public.set_updated_at();

drop trigger if exists trg_property_views_set_updated_at on public.property_views;
create trigger trg_property_views_set_updated_at
before insert or update on public.property_views
for each row execute function public.set_updated_at();

drop trigger if exists trg_conversations_set_updated_at on public.conversations;
create trigger trg_conversations_set_updated_at
before insert or update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists trg_messages_set_updated_at on public.messages;
create trigger trg_messages_set_updated_at
before insert or update on public.messages
for each row execute function public.set_updated_at();

drop trigger if exists trg_notifications_set_updated_at on public.notifications;
create trigger trg_notifications_set_updated_at
before insert or update on public.notifications
for each row execute function public.set_updated_at();
