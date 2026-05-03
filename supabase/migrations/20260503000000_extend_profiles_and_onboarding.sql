-- Latch — extend profiles for onboarding-collected context, add onboarding-progress table.
-- Apply manually via Supabase SQL Editor (no migration runner wired up).

-- ─── 1. Extend profiles ────────────────────────────────────────────────────
-- New columns are nullable on the table because the handle_new_user() trigger
-- inserts an empty row at signup. The application enforces "all required
-- fields present" at the moment onboarded_at is set (final UPSERT in the wizard).
alter table public.profiles
  add column if not exists is_first_child boolean,
  add column if not exists feeding_type text
    check (feeding_type in ('exclusive', 'mixed')),
  add column if not exists breastfeeding_start_date date,
  add column if not exists current_rhythm text
    check (current_rhythm in
      ('very_close', 'regular', 'spaced', 'very_variable', 'just_started')),
  add column if not exists has_professional_support boolean default false,
  add column if not exists general_feeling text
    check (general_feeling is null or char_length(general_feeling) <= 500),
  add column if not exists current_concern text
    check (current_concern is null or char_length(current_concern) <= 500),
  add column if not exists onboarded_at timestamptz,
  add column if not exists updated_at timestamptz default now();

-- Partial index: middleware does a PK lookup filtered by onboarded_at IS NOT NULL.
create index if not exists profiles_onboarded_idx
  on public.profiles (id)
  where onboarded_at is not null;

-- updated_at auto-bump
create or replace function public.touch_profiles_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_profiles_updated_at();

-- ─── 2. user_onboarding_progress ──────────────────────────────────────────
-- One row per user, lets the wizard resume after abandon.
create table if not exists public.user_onboarding_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_step smallint not null default 1,
  partial_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_onboarding_progress enable row level security;

drop policy if exists "onboarding_progress_select_own" on public.user_onboarding_progress;
create policy "onboarding_progress_select_own"
  on public.user_onboarding_progress for select using (auth.uid() = user_id);

drop policy if exists "onboarding_progress_insert_own" on public.user_onboarding_progress;
create policy "onboarding_progress_insert_own"
  on public.user_onboarding_progress for insert with check (auth.uid() = user_id);

drop policy if exists "onboarding_progress_update_own" on public.user_onboarding_progress;
create policy "onboarding_progress_update_own"
  on public.user_onboarding_progress for update using (auth.uid() = user_id);

drop policy if exists "onboarding_progress_delete_own" on public.user_onboarding_progress;
create policy "onboarding_progress_delete_own"
  on public.user_onboarding_progress for delete using (auth.uid() = user_id);
