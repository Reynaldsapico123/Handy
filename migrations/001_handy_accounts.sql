create table if not exists public.handy_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_premium boolean not null default false,
  premium_tier text not null default 'free',
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.handy_profiles enable row level security;

create policy "Users read their own Handy profile"
  on public.handy_profiles for select
  using (auth.uid() = id);

create policy "Users update their own Handy profile"
  on public.handy_profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create table if not exists public.handy_user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.handy_user_state enable row level security;

create policy "Users read their own Handy state"
  on public.handy_user_state for select
  using (auth.uid() = user_id);

create policy "Users insert their own Handy state"
  on public.handy_user_state for insert
  with check (auth.uid() = user_id);

create policy "Users update their own Handy state"
  on public.handy_user_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.handy_shared_trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  share_token text not null unique,
  title text not null,
  state jsonb not null default '{}'::jsonb,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.handy_shared_trips enable row level security;

create policy "Owners manage their shared trips"
  on public.handy_shared_trips for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create or replace function public.get_shared_handy_trip(p_share_token text)
returns table (
  id uuid,
  title text,
  state jsonb,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select id, title, state, updated_at
  from public.handy_shared_trips
  where share_token = p_share_token
    and is_public = true
  limit 1;
$$;

revoke all on function public.get_shared_handy_trip(text) from public;
grant execute on function public.get_shared_handy_trip(text) to anon, authenticated;

create or replace function public.handle_new_handy_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.handy_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_handy on auth.users;
create trigger on_auth_user_created_handy
  after insert on auth.users
  for each row execute procedure public.handle_new_handy_user();
