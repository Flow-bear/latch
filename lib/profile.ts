import type { SupabaseClient } from '@supabase/supabase-js'

export type FeedingType = 'exclusive' | 'mixed'
export type CurrentRhythm =
  | 'very_close'
  | 'regular'
  | 'spaced'
  | 'very_variable'
  | 'just_started'

export type Profile = {
  id: string
  baby_name: string | null
  baby_birth_date: string | null
  timezone: string
  is_first_child: boolean | null
  feeding_type: FeedingType | null
  breastfeeding_start_date: string | null
  current_rhythm: CurrentRhythm | null
  has_professional_support: boolean | null
  general_feeling: string | null
  current_concern: string | null
  onboarded_at: string | null
  created_at: string
  updated_at: string | null
}

export type OnboardingProgress = {
  user_id: string
  current_step: number
  partial_data: Partial<Profile>
  updated_at: string
}

export const PROFILE_COLUMNS =
  'id, baby_name, baby_birth_date, timezone, is_first_child, feeding_type, breastfeeding_start_date, current_rhythm, has_professional_support, general_feeling, current_concern, onboarded_at, created_at, updated_at'

export async function getProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<Profile | null> {
  const { data } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle()
  return (data as Profile | null) ?? null
}

export function isOnboarded(profile: Profile | null | undefined): boolean {
  return !!profile?.onboarded_at
}

export const RHYTHM_LABELS: Record<CurrentRhythm, string> = {
  very_close: 'Très rapproché (toutes les 1-2h)',
  regular: 'Régulier (toutes les 2-4h)',
  spaced: 'Espacé (4h ou plus entre les tétées)',
  very_variable: 'Très variable, ça change tout le temps',
  just_started: "C'est le tout début, je découvre encore",
}

export const FEEDING_TYPE_LABELS: Record<FeedingType, string> = {
  exclusive: 'Exclusif (sein uniquement)',
  mixed: 'Mixte (sein + biberon)',
}
