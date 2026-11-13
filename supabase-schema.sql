-- ============================================================================
-- Launch Hub schema. Run this ONCE in your new, empty Supabase project:
-- Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- Safe to re-run if something goes wrong partway through.
-- ============================================================================

create table if not exists public.apps (
  key text primary key,                 -- short code, e.g. 'family_office'
  name text not null,                   -- "Family Office"
  url text not null,                    -- "https://your-app.netlify.app"
  description text not null default '',
  icon text not null default '',        -- a single emoji is simplest, e.g. '🏦'
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('admin','user')),
  is_disabled boolean not null default false,
  invited_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.member_apps (
  user_id uuid not null references public.members(user_id) on delete cascade,
  app_key text not null references public.apps(key) on delete cascade,
  primary key (user_id, app_key)
);

alter table public.apps enable row level security;
alter table public.members enable row level security;
alter table public.member_apps enable row level security;

-- Any signed-in person can see the app directory (names/urls aren't secret)
-- and their own membership / access rows. All writes (invite, edit, assign
-- access) go through the admin-api function using the service-role key,
-- which bypasses RLS entirely, so there are no write policies here on purpose.
drop policy if exists apps_read on public.apps;
create policy apps_read on public.apps for select to authenticated using (true);

drop policy if exists members_read_self on public.members;
create policy members_read_self on public.members for select to authenticated using (user_id = auth.uid());

drop policy if exists member_apps_read_self on public.member_apps;
create policy member_apps_read_self on public.member_apps for select to authenticated using (user_id = auth.uid());

revoke all on public.apps, public.members, public.member_apps from anon;
grant select on public.apps, public.members, public.member_apps to authenticated;
grant all on public.apps, public.members, public.member_apps to service_role;

-- Seed one example row so the Apps list isn't empty on first login.
-- Edit the URL (and add your other 3 apps) from the Manage > Apps screen after you sign in.
insert into public.apps (key, name, url, description, icon, sort) values
  ('antar_archive', 'Antar Family Archive', 'https://antarfamily.netlify.app', 'Family tree, photos & archive', '📷', 1)
on conflict (key) do nothing;
