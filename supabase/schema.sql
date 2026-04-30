-- Latch schema v1
-- Run this once in the Supabase SQL Editor.

-- ─── 1. profiles (extends auth.users) ─────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  baby_name text,
  baby_birth_date date,
  timezone text not null default 'Europe/Paris',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own"
  on public.profiles for update using (auth.uid() = id);
create policy "profiles_insert_own"
  on public.profiles for insert with check (auth.uid() = id);

-- Auto-create profile on user signup
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─── 2. feedings ──────────────────────────────────────────────────────────
create table public.feedings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  side text not null check (side in ('left', 'right', 'both')),
  mood_emoji text,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create index feedings_user_started_at_idx
  on public.feedings(user_id, started_at desc);

alter table public.feedings enable row level security;

create policy "feedings_select_own"
  on public.feedings for select using (auth.uid() = user_id);
create policy "feedings_insert_own"
  on public.feedings for insert with check (auth.uid() = user_id);
create policy "feedings_update_own"
  on public.feedings for update using (auth.uid() = user_id);
create policy "feedings_delete_own"
  on public.feedings for delete using (auth.uid() = user_id);

-- ─── 3. morning_checkins ──────────────────────────────────────────────────
create table public.morning_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  for_date date not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, for_date)
);

create index morning_checkins_user_date_idx
  on public.morning_checkins(user_id, for_date desc);

alter table public.morning_checkins enable row level security;

-- Users can only read and mark-as-read their own check-ins.
-- Inserts happen server-side via the cron job (service_role bypasses RLS).
create policy "morning_checkins_select_own"
  on public.morning_checkins for select using (auth.uid() = user_id);
create policy "morning_checkins_update_own"
  on public.morning_checkins for update using (auth.uid() = user_id);

-- ─── 4. ai_questions ──────────────────────────────────────────────────────
create table public.ai_questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  response text,
  asked_at timestamptz not null default now()
);

create index ai_questions_user_asked_idx
  on public.ai_questions(user_id, asked_at desc);

alter table public.ai_questions enable row level security;

create policy "ai_questions_select_own"
  on public.ai_questions for select using (auth.uid() = user_id);
create policy "ai_questions_insert_own"
  on public.ai_questions for insert with check (auth.uid() = user_id);
