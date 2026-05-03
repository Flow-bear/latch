'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useNightMode } from '@/lib/hooks/useNightMode'
import { getPalette } from '@/lib/palette'
import { createClient } from '@/lib/supabase/client'
import {
  FEEDING_TYPE_LABELS,
  RHYTHM_LABELS,
  type CurrentRhythm,
  type FeedingType,
  type Profile,
} from '@/lib/profile'

type FormData = {
  baby_birth_date: string | null
  is_first_child: boolean | null
  feeding_type: FeedingType | null
  breastfeeding_start_date: string | null
  current_rhythm: CurrentRhythm | null
  has_professional_support: boolean | null
  baby_name: string | null
  current_concern: string | null
  general_feeling: string | null
}

const EMPTY: FormData = {
  baby_birth_date: null,
  is_first_child: null,
  feeding_type: null,
  breastfeeding_start_date: null,
  current_rhythm: null,
  has_professional_support: null,
  baby_name: null,
  current_concern: null,
  general_feeling: null,
}

const TOTAL_STEPS = 7

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function fiveYearsAgoISO(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 5)
  return d.toISOString().slice(0, 10)
}

export default function OnboardingPage() {
  const router = useRouter()
  const night = useNightMode()
  const c = getPalette(night)

  const [step, setStep] = useState(1)
  const [data, setData] = useState<FormData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  // ─── Mount: load session, profile (for prefill), and saved progress
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/login')
        return
      }
      if (cancelled) return
      setUserId(user.id)

      // Pre-fill from existing profile (e.g. baby_name/baby_birth_date set elsewhere)
      const { data: profile } = await supabase
        .from('profiles')
        .select(
          'baby_name, baby_birth_date, is_first_child, feeding_type, breastfeeding_start_date, current_rhythm, has_professional_support, general_feeling, current_concern'
        )
        .eq('id', user.id)
        .maybeSingle()

      const { data: progress } = await supabase
        .from('user_onboarding_progress')
        .select('current_step, partial_data')
        .eq('user_id', user.id)
        .maybeSingle()

      if (cancelled) return

      const merged: FormData = {
        ...EMPTY,
        ...(profile ?? {}),
        ...((progress?.partial_data ?? {}) as Partial<FormData>),
      }
      setData(merged)
      if (progress?.current_step) {
        setStep(Math.min(Math.max(1, progress.current_step), TOTAL_STEPS))
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  // ─── Persist progress (fire-and-forget; UI doesn't wait)
  async function saveProgress(nextStep: number, nextData: FormData) {
    if (!userId) return
    const supabase = createClient()
    await supabase
      .from('user_onboarding_progress')
      .upsert(
        {
          user_id: userId,
          current_step: nextStep,
          partial_data: nextData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )
  }

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setData((prev) => ({ ...prev, [key]: value }))
  }

  function goNext() {
    const next = Math.min(step + 1, TOTAL_STEPS)
    // When entering step 4, default breastfeeding_start_date to baby_birth_date if empty
    let nextData = data
    if (next === 4 && !data.breastfeeding_start_date && data.baby_birth_date) {
      nextData = { ...data, breastfeeding_start_date: data.baby_birth_date }
      setData(nextData)
    }
    setStep(next)
    void saveProgress(next, nextData)
  }

  function goPrev() {
    const prev = Math.max(step - 1, 1)
    setStep(prev)
    void saveProgress(prev, data)
  }

  function skip() {
    // Same as goNext but doesn't validate (used on step 6 only)
    goNext()
  }

  async function submit() {
    if (!userId || submitting) return
    setSubmitting(true)
    const supabase = createClient()

    const payload = {
      id: userId,
      baby_name: data.baby_name?.trim() || null,
      baby_birth_date: data.baby_birth_date,
      is_first_child: data.is_first_child,
      feeding_type: data.feeding_type,
      breastfeeding_start_date: data.breastfeeding_start_date,
      current_rhythm: data.current_rhythm,
      has_professional_support: data.has_professional_support ?? false,
      current_concern: data.current_concern?.trim() || null,
      general_feeling: data.general_feeling?.trim() || null,
      onboarded_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('profiles')
      .upsert(payload, { onConflict: 'id' })

    if (error) {
      console.error('onboarding submit failed', error)
      setSubmitting(false)
      return
    }

    await supabase.from('user_onboarding_progress').delete().eq('user_id', userId)
    router.replace('/')
  }

  // ─── Validation per step
  const canAdvance = useMemo(() => {
    switch (step) {
      case 1: {
        if (!data.baby_birth_date) return false
        const d = data.baby_birth_date
        return d <= todayISO() && d >= fiveYearsAgoISO()
      }
      case 2:
        return data.is_first_child !== null
      case 3:
        return data.feeding_type !== null
      case 4: {
        if (!data.breastfeeding_start_date) return false
        return data.breastfeeding_start_date <= todayISO()
      }
      case 5:
        return data.current_rhythm !== null
      case 6:
      case 7:
        return true
      default:
        return false
    }
  }, [step, data])

  const isLast = step === TOTAL_STEPS
  const isOptional = step === 6 || step === 7

  if (loading) {
    return (
      <main className={`min-h-screen flex items-center justify-center ${c.bg}`}>
        <div className={`text-xs tracking-[0.32em] uppercase ${c.muted}`}>…</div>
      </main>
    )
  }

  return (
    <main className={`min-h-screen flex flex-col ${c.bg} ${c.text}`}>
      {/* Header: progress */}
      <header className="px-6 pt-8 pb-6">
        <div className={`text-xs tracking-[0.2em] uppercase mb-3 ${c.muted}`}>
          Étape {step} sur {TOTAL_STEPS}
        </div>
        <div className={`h-1 rounded-full overflow-hidden ${c.cardBg}`}>
          <div
            className={`h-full ${c.accent} transition-all duration-300`}
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </header>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto px-6 pb-40">
        <div className="max-w-md mx-auto">
          {step === 1 && <Step1 data={data} update={update} c={c} />}
          {step === 2 && <Step2 data={data} update={update} c={c} />}
          {step === 3 && <Step3 data={data} update={update} c={c} />}
          {step === 4 && <Step4 data={data} update={update} c={c} />}
          {step === 5 && <Step5 data={data} update={update} c={c} />}
          {step === 6 && <Step6 data={data} update={update} c={c} />}
          {step === 7 && <Step7 data={data} update={update} c={c} />}
        </div>
      </div>

      {/* Footer */}
      <footer
        className={`fixed bottom-0 left-0 right-0 px-6 py-4 ${c.bg} border-t ${c.cardBorder}`}
      >
        <div className="max-w-md mx-auto flex items-center gap-3">
          <button
            onClick={goPrev}
            disabled={step === 1}
            className={`px-5 py-3 rounded-full text-sm font-light tracking-[0.15em] uppercase border ${c.ringStrong} ${c.text} ${c.hoverFill} disabled:opacity-30 disabled:pointer-events-none`}
          >
            Précédent
          </button>

          {isOptional && step === 6 && (
            <button
              onClick={skip}
              className={`text-xs underline underline-offset-4 ${c.muted}`}
            >
              Passer
            </button>
          )}

          <button
            onClick={isLast ? submit : goNext}
            disabled={!canAdvance || submitting}
            className={`flex-1 py-3 rounded-full text-sm font-light tracking-[0.2em] uppercase ${c.accent} ${c.accentText} disabled:opacity-40 disabled:pointer-events-none`}
          >
            {submitting ? '…' : isLast ? 'Terminer' : 'Suivant'}
          </button>
        </div>
      </footer>
    </main>
  )
}

// ─── Step components ─────────────────────────────────────────────────────

type StepProps = {
  data: FormData
  update: <K extends keyof FormData>(key: K, value: FormData[K]) => void
  c: ReturnType<typeof getPalette>
}

function StepTitle({ title, subtitle, c }: { title: string; subtitle?: string; c: StepProps['c'] }) {
  return (
    <div className="mb-8">
      <h2 className={`text-2xl font-light leading-tight ${c.text}`}>{title}</h2>
      {subtitle && (
        <p className={`mt-3 text-sm leading-relaxed ${c.soft}`}>{subtitle}</p>
      )}
    </div>
  )
}

function ChoiceButton({
  selected,
  onClick,
  children,
  c,
}: {
  selected: boolean
  onClick: () => void
  children: React.ReactNode
  c: StepProps['c']
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`w-full text-left px-5 py-4 rounded-2xl border-2 text-base font-light transition-colors ${
        selected
          ? `${c.accent} ${c.accentText} border-transparent`
          : `${c.ringStrong} ${c.text} ${c.hoverFill}`
      }`}
    >
      {children}
    </button>
  )
}

function Step1({ data, update, c }: StepProps) {
  return (
    <>
      <StepTitle
        title="Quand est né bébé ?"
        subtitle="Pour adapter les conseils à son âge."
        c={c}
      />
      <input
        type="date"
        value={data.baby_birth_date ?? ''}
        max={todayISO()}
        min={fiveYearsAgoISO()}
        onChange={(e) => update('baby_birth_date', e.target.value || null)}
        className={`w-full px-5 py-4 rounded-2xl border text-lg ${c.inputBg} ${c.cardBorder} ${c.text} focus:outline-none focus:ring-2 ${c.ringStrong}`}
      />
    </>
  )
}

function Step2({ data, update, c }: StepProps) {
  return (
    <>
      <StepTitle title="C'est ton premier enfant ?" c={c} />
      <div className="flex flex-col gap-3">
        <ChoiceButton
          selected={data.is_first_child === true}
          onClick={() => update('is_first_child', true)}
          c={c}
        >
          Oui, mon premier
        </ChoiceButton>
        <ChoiceButton
          selected={data.is_first_child === false}
          onClick={() => update('is_first_child', false)}
          c={c}
        >
          Non, j&apos;en ai déjà
        </ChoiceButton>
      </div>
    </>
  )
}

function Step3({ data, update, c }: StepProps) {
  return (
    <>
      <StepTitle title="Comment se passe l'allaitement aujourd'hui ?" c={c} />
      <div className="flex flex-col gap-3">
        {(Object.keys(FEEDING_TYPE_LABELS) as FeedingType[]).map((key) => (
          <ChoiceButton
            key={key}
            selected={data.feeding_type === key}
            onClick={() => update('feeding_type', key)}
            c={c}
          >
            {FEEDING_TYPE_LABELS[key]}
          </ChoiceButton>
        ))}
      </div>
    </>
  )
}

function Step4({ data, update, c }: StepProps) {
  return (
    <>
      <StepTitle
        title="Tu allaites depuis quand ?"
        subtitle="Pour situer où tu en es dans ton parcours."
        c={c}
      />
      <input
        type="date"
        value={data.breastfeeding_start_date ?? ''}
        max={todayISO()}
        onChange={(e) => update('breastfeeding_start_date', e.target.value || null)}
        className={`w-full px-5 py-4 rounded-2xl border text-lg ${c.inputBg} ${c.cardBorder} ${c.text} focus:outline-none focus:ring-2 ${c.ringStrong}`}
      />
    </>
  )
}

function Step5({ data, update, c }: StepProps) {
  return (
    <>
      <StepTitle
        title="Comment décrirais-tu le rythme des tétées en ce moment ?"
        subtitle="Une lecture qualitative suffit, on affinera ensemble avec les données."
        c={c}
      />
      <div className="flex flex-col gap-3">
        {(Object.keys(RHYTHM_LABELS) as CurrentRhythm[]).map((key) => (
          <ChoiceButton
            key={key}
            selected={data.current_rhythm === key}
            onClick={() => update('current_rhythm', key)}
            c={c}
          >
            {RHYTHM_LABELS[key]}
          </ChoiceButton>
        ))}
      </div>
    </>
  )
}

function Step6({ data, update, c }: StepProps) {
  return (
    <>
      <StepTitle
        title="As-tu un suivi par une sage-femme ou une conseillère en lactation actuellement ?"
        subtitle="Si oui, je serai plus à l'aise pour te suggérer de consulter en cas de doute."
        c={c}
      />
      <div className="flex flex-col gap-3">
        <ChoiceButton
          selected={data.has_professional_support === true}
          onClick={() => update('has_professional_support', true)}
          c={c}
        >
          Oui
        </ChoiceButton>
        <ChoiceButton
          selected={data.has_professional_support === false}
          onClick={() => update('has_professional_support', false)}
          c={c}
        >
          Non
        </ChoiceButton>
      </div>
    </>
  )
}

function Step7({ data, update, c }: StepProps) {
  const concern = data.current_concern ?? ''
  const feeling = data.general_feeling ?? ''
  return (
    <>
      <StepTitle title="Quelque chose à partager ?" c={c} />

      <div className="mb-8">
        <label className={`text-sm leading-relaxed block mb-3 ${c.soft}`}>
          Y a-t-il quelque chose qui te préoccupe dans l&apos;allaitement en ce
          moment&nbsp;? <span className={c.muted}>(optionnel)</span>
        </label>
        <textarea
          value={concern}
          onChange={(e) =>
            update('current_concern', e.target.value.slice(0, 500))
          }
          placeholder="Ex : douleurs au sein gauche, doute sur la prise de poids du bébé, fatigue intense…"
          rows={4}
          className={`w-full px-4 py-3 rounded-2xl border text-base resize-none ${c.inputBg} ${c.cardBorder} ${c.text} placeholder:opacity-40 focus:outline-none focus:ring-2 ${c.ringStrong}`}
        />
        <div className={`text-xs mt-1 text-right ${c.muted}`}>
          {concern.length}/500
        </div>
      </div>

      <div className="mb-8">
        <label className={`text-sm leading-relaxed block mb-3 ${c.soft}`}>
          Comment ça se passe pour toi en général&nbsp;?{' '}
          <span className={c.muted}>(optionnel)</span>
        </label>
        <textarea
          value={feeling}
          onChange={(e) =>
            update('general_feeling', e.target.value.slice(0, 500))
          }
          placeholder="Ex : un peu fatiguée mais ça va, ou parfois découragée, comme tu le sens…"
          rows={4}
          className={`w-full px-4 py-3 rounded-2xl border text-base resize-none ${c.inputBg} ${c.cardBorder} ${c.text} placeholder:opacity-40 focus:outline-none focus:ring-2 ${c.ringStrong}`}
        />
        <div className={`text-xs mt-1 text-right ${c.muted}`}>
          {feeling.length}/500
        </div>
      </div>

      <div>
        <label className={`text-sm leading-relaxed block mb-3 ${c.soft}`}>
          Comment s&apos;appelle bébé&nbsp;?{' '}
          <span className={c.muted}>(optionnel)</span>
        </label>
        <input
          type="text"
          value={data.baby_name ?? ''}
          onChange={(e) => update('baby_name', e.target.value)}
          placeholder="Prénom"
          className={`w-full px-4 py-3 rounded-2xl border text-base ${c.inputBg} ${c.cardBorder} ${c.text} placeholder:opacity-40 focus:outline-none focus:ring-2 ${c.ringStrong}`}
        />
      </div>
    </>
  )
}

// satisfy TS: Profile import is type-only used elsewhere
export type { Profile }
