-- Latch schema v1
-- Run this once in the Supabase SQL Editor.

-- ─── 1. profiles (extends auth.users) ─────────────────────────────────────
-- Onboarding-collected fields are nullable on the table because the trigger
-- inserts an empty row at signup. The wizard fills them and sets onboarded_at;
-- the middleware uses onboarded_at IS NOT NULL as the gate.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  baby_name text,
  baby_birth_date date,
  timezone text not null default 'Europe/Paris',
  is_first_child boolean,
  feeding_type text check (feeding_type in ('exclusive', 'mixed')),
  breastfeeding_start_date date,
  current_rhythm text check (current_rhythm in
    ('very_close', 'regular', 'spaced', 'very_variable', 'just_started')),
  has_professional_support boolean default false,
  general_feeling text check (general_feeling is null or char_length(general_feeling) <= 500),
  current_concern text check (current_concern is null or char_length(current_concern) <= 500),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create index profiles_onboarded_idx
  on public.profiles (id)
  where onboarded_at is not null;

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

-- updated_at auto-bump
create function public.touch_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- ─── 1bis. user_onboarding_progress ───────────────────────────────────────
-- Ephemeral table: stores partial wizard state so an abandoned session can resume.
-- Deleted at the end of the wizard.
create table public.user_onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_step smallint not null default 1,
  partial_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding_progress enable row level security;

create policy "onboarding_progress_select_own"
  on public.user_onboarding_progress for select using (auth.uid() = user_id);
create policy "onboarding_progress_insert_own"
  on public.user_onboarding_progress for insert with check (auth.uid() = user_id);
create policy "onboarding_progress_update_own"
  on public.user_onboarding_progress for update using (auth.uid() = user_id);
create policy "onboarding_progress_delete_own"
  on public.user_onboarding_progress for delete using (auth.uid() = user_id);

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
