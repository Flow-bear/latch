'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useNightMode } from '@/lib/hooks/useNightMode'
import { getPalette } from '@/lib/palette'
import { createClient } from '@/lib/supabase/client'
import {
  FEEDING_TYPE_LABELS,
  PROFILE_COLUMNS,
  RHYTHM_LABELS,
  type CurrentRhythm,
  type FeedingType,
  type Profile,
} from '@/lib/profile'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function SettingsPage() {
  const router = useRouter()
  const night = useNightMode()
  const c = getPalette(night)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Partial<Profile>>({})

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled) return
      setUserId(user.id)
      setProfile((data as Profile | null) ?? {})
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }))
  }

  const concernLen = (profile.current_concern ?? '').length
  const feelingLen = (profile.general_feeling ?? '').length

  const isValid = useMemo(() => {
    return (
      !!profile.baby_birth_date &&
      profile.is_first_child !== null &&
      profile.is_first_child !== undefined &&
      !!profile.feeding_type &&
      !!profile.breastfeeding_start_date &&
      !!profile.current_rhythm &&
      concernLen <= 500 &&
      feelingLen <= 500
    )
  }, [profile, concernLen, feelingLen])

  async function save() {
    if (!userId || saving || !isValid) return
    setSaving(true)
    const supabase = createClient()
    const { error } = await supabase
      .from('profiles')
      .update({
        baby_name: profile.baby_name?.trim() || null,
        baby_birth_date: profile.baby_birth_date,
        is_first_child: profile.is_first_child,
        feeding_type: profile.feeding_type,
        breastfeeding_start_date: profile.breastfeeding_start_date,
        current_rhythm: profile.current_rhythm,
        has_professional_support: profile.has_professional_support ?? false,
        current_concern: profile.current_concern?.trim() || null,
        general_feeling: profile.general_feeling?.trim() || null,
      })
      .eq('id', userId)
    setSaving(false)
    if (error) {
      console.error('settings save failed', error)
      return
    }
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(null), 2500)
  }

  async function restartOnboarding() {
    if (!userId || resetting) return
    const ok = window.confirm(
      'Cela supprimera ton profil actuel et te redirigera vers le tour de bienvenue. Confirmer ?'
    )
    if (!ok) return
    setResetting(true)
    const supabase = createClient()
    // Keep baby_name/baby_birth_date so the wizard pre-fills them; clear the rest.
    await supabase
      .from('profiles')
      .update({
        onboarded_at: null,
        is_first_child: null,
        feeding_type: null,
        breastfeeding_start_date: null,
        current_rhythm: null,
        has_professional_support: false,
        current_concern: null,
        general_feeling: null,
      })
      .eq('id', userId)
    await supabase
      .from('user_onboarding_progress')
      .delete()
      .eq('user_id', userId)
    router.replace('/onboarding')
  }

  if (loading) {
    return (
      <main className={`min-h-[100dvh] flex items-center justify-center ${c.bg}`}>
        <div className={`text-xs tracking-[0.32em] uppercase ${c.muted}`}>…</div>
      </main>
    )
  }

  return (
    <main className={`min-h-[100dvh] flex flex-col ${c.bg} ${c.text}`}>
      <header className="px-6 pt-6 pb-2 flex items-center justify-between">
        <Link
          href="/"
          aria-label="Retour"
          className={`text-base font-light tracking-[0.32em] uppercase ${c.soft}`}
        >
          ← Latch
        </Link>
        <span className={`text-xs tracking-[0.2em] uppercase ${c.muted}`}>
          Profil
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-32">
        <div className="max-w-md mx-auto pt-8 flex flex-col gap-8">
          <Field label="Prénom du bébé (optionnel)" c={c}>
            <input
              type="text"
              value={profile.baby_name ?? ''}
              onChange={(e) => update('baby_name', e.target.value)}
              placeholder="Prénom"
              className={inputCls(c)}
            />
          </Field>

          <Field label="Date de naissance du bébé" c={c}>
            <input
              type="date"
              value={profile.baby_birth_date ?? ''}
              max={todayISO()}
              onChange={(e) =>
                update('baby_birth_date', e.target.value || null)
              }
              className={inputCls(c)}
            />
          </Field>

          <Field label="C'est ton premier enfant ?" c={c}>
            <Toggle
              value={profile.is_first_child}
              onChange={(v) => update('is_first_child', v)}
              labels={['Oui', 'Non']}
              c={c}
            />
          </Field>

          <Field label="Type d'allaitement" c={c}>
            <div className="flex flex-col gap-2">
              {(Object.keys(FEEDING_TYPE_LABELS) as FeedingType[]).map((k) => (
                <RadioRow
                  key={k}
                  label={FEEDING_TYPE_LABELS[k]}
                  selected={profile.feeding_type === k}
                  onClick={() => update('feeding_type', k)}
                  c={c}
                />
              ))}
            </div>
          </Field>

          <Field label="Tu allaites depuis quand ?" c={c}>
            <input
              type="date"
              value={profile.breastfeeding_start_date ?? ''}
              max={todayISO()}
              onChange={(e) =>
                update('breastfeeding_start_date', e.target.value || null)
              }
              className={inputCls(c)}
            />
          </Field>

          <Field label="Rythme actuel" c={c}>
            <div className="flex flex-col gap-2">
              {(Object.keys(RHYTHM_LABELS) as CurrentRhythm[]).map((k) => (
                <RadioRow
                  key={k}
                  label={RHYTHM_LABELS[k]}
                  selected={profile.current_rhythm === k}
                  onClick={() => update('current_rhythm', k)}
                  c={c}
                />
              ))}
            </div>
          </Field>

          <Field label="Suivi par une sage-femme ou conseillère en lactation" c={c}>
            <Toggle
              value={profile.has_professional_support ?? null}
              onChange={(v) => update('has_professional_support', v)}
              labels={['Oui', 'Non']}
              c={c}
            />
          </Field>

          <Field label="Préoccupation actuelle (optionnel)" c={c}>
            <textarea
              value={profile.current_concern ?? ''}
              onChange={(e) =>
                update('current_concern', e.target.value.slice(0, 500))
              }
              rows={4}
              className={`${inputCls(c)} resize-none`}
              placeholder="Ex : douleurs au sein gauche, doute sur la prise de poids…"
            />
            <div className={`text-xs mt-1 text-right ${c.muted}`}>
              {concernLen}/500
            </div>
          </Field>

          <Field label="Ressenti général (optionnel)" c={c}>
            <textarea
              value={profile.general_feeling ?? ''}
              onChange={(e) =>
                update('general_feeling', e.target.value.slice(0, 500))
              }
              rows={4}
              className={`${inputCls(c)} resize-none`}
              placeholder="Ex : un peu fatiguée mais ça va…"
            />
            <div className={`text-xs mt-1 text-right ${c.muted}`}>
              {feelingLen}/500
            </div>
          </Field>

          {/* Danger zone */}
          <div className={`mt-8 pt-8 border-t ${c.cardBorder}`}>
            <div className={`text-xs tracking-[0.2em] uppercase mb-4 ${c.muted}`}>
              Avancé
            </div>
            <button
              onClick={restartOnboarding}
              disabled={resetting}
              className="w-full px-5 py-4 rounded-2xl border-2 border-[#a44] text-[#a44] text-sm font-light tracking-[0.15em] uppercase active:bg-[#a44]/10 disabled:opacity-50"
            >
              {resetting ? '…' : "Recommencer l'onboarding"}
            </button>
          </div>
        </div>
      </div>

      {/* Sticky save bar */}
      <footer
        className={`fixed bottom-0 left-0 right-0 px-6 py-4 ${c.bg} border-t ${c.cardBorder}`}
      >
        <div className="max-w-md mx-auto flex items-center gap-3">
          {savedAt && (
            <span className={`text-xs ${c.muted}`}>Enregistré ✓</span>
          )}
          <button
            onClick={save}
            disabled={!isValid || saving}
            className={`flex-1 py-3 rounded-full text-sm font-light tracking-[0.2em] uppercase ${c.accent} ${c.accentText} disabled:opacity-40 disabled:pointer-events-none`}
          >
            {saving ? '…' : 'Enregistrer'}
          </button>
        </div>
      </footer>
    </main>
  )
}

function inputCls(c: ReturnType<typeof getPalette>): string {
  return `w-full px-4 py-3 rounded-2xl border text-base ${c.inputBg} ${c.cardBorder} ${c.text} placeholder:opacity-40 focus:outline-none focus:ring-2 ${c.ringStrong}`
}

function Field({
  label,
  children,
  c,
}: {
  label: string
  children: React.ReactNode
  c: ReturnType<typeof getPalette>
}) {
  return (
    <div>
      <label className={`text-sm leading-relaxed block mb-3 ${c.soft}`}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Toggle({
  value,
  onChange,
  labels,
  c,
}: {
  value: boolean | null | undefined
  onChange: (v: boolean) => void
  labels: [string, string]
  c: ReturnType<typeof getPalette>
}) {
  return (
    <div className="flex gap-3">
      {[true, false].map((v, i) => {
        const active = value === v
        return (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            aria-pressed={active}
            className={`flex-1 py-3 rounded-full text-sm font-light tracking-[0.15em] uppercase border-2 transition-colors ${
              active
                ? `${c.accent} ${c.accentText} border-transparent`
                : `${c.ringStrong} ${c.text} ${c.hoverFill}`
            }`}
          >
            {labels[i]}
          </button>
        )
      })}
    </div>
  )
}

function RadioRow({
  label,
  selected,
  onClick,
  c,
}: {
  label: string
  selected: boolean
  onClick: () => void
  c: ReturnType<typeof getPalette>
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full text-left px-4 py-3 rounded-2xl border-2 text-sm font-light transition-colors ${
        selected
          ? `${c.accent} ${c.accentText} border-transparent`
          : `${c.ringStrong} ${c.text} ${c.hoverFill}`
      }`}
    >
      {label}
    </button>
  )
}
