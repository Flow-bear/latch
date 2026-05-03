'use client'

import { useEffect, useState } from 'react'
import { useNightMode } from '@/lib/hooks/useNightMode'
import { db } from '@/lib/db'
import { syncPendingFeedings } from '@/lib/sync'
import { createClient } from '@/lib/supabase/client'

interface Checkin {
  id: string
  message: string
  read_at: string | null
}

type FeedingState = 'idle' | 'active' | 'done'
type Side = 'left' | 'right'

export default function Home() {
  const night = useNightMode()
  const [state, setState] = useState<FeedingState>('idle')
  const [suggestedSide, setSuggestedSide] = useState<Side>('right')
  const [side, setSide] = useState<Side>('right')
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  const [endedAt, setEndedAt] = useState<Date | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [mood, setMood] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [checkin, setCheckin] = useState<Checkin | null>(null)
  const [checkinCollapsed, setCheckinCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const last = await db.feedings.orderBy('startedAt').reverse().first()
      if (!cancelled && last) {
        setSuggestedSide(last.side === 'left' ? 'right' : 'left')
      }
    })()
    void syncPendingFeedings()
    void (async () => {
      const supabase = createClient()
      const today = new Date().toISOString().slice(0, 10)
      const { data } = await supabase
        .from('morning_checkins')
        .select('id, message, read_at')
        .eq('for_date', today)
        .maybeSingle()
      if (!cancelled && data) {
        setCheckin(data)
        if (localStorage.getItem(`latch:checkin-collapsed:${today}`)) {
          setCheckinCollapsed(true)
        }
      }
    })()
    const onOnline = () => {
      void syncPendingFeedings()
    }
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
    }
  }, [])

  useEffect(() => {
    if (state !== 'active' || !startedAt) return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [state, startedAt])

  async function markCheckinRead() {
    if (!checkin) return
    const today = new Date().toISOString().slice(0, 10)
    localStorage.setItem(`latch:checkin-collapsed:${today}`, '1')
    setCheckinCollapsed(true)
    const supabase = createClient()
    await supabase
      .from('morning_checkins')
      .update({ read_at: new Date().toISOString() })
      .eq('id', checkin.id)
  }

  function expandCheckin() {
    const today = new Date().toISOString().slice(0, 10)
    localStorage.removeItem(`latch:checkin-collapsed:${today}`)
    setCheckinCollapsed(false)
  }

  function startFeeding() {
    setSide(suggestedSide)
    setStartedAt(new Date())
    setElapsed(0)
    setState('active')
  }

  function stopFeeding() {
    setEndedAt(new Date())
    setState('done')
  }

  async function persistAndReset(withMood: boolean) {
    if (!startedAt || !endedAt) return
    await db.feedings.add({
      clientId: crypto.randomUUID(),
      startedAt,
      endedAt,
      side,
      mood: withMood ? mood : null,
      note: withMood ? note.trim() : '',
      synced: false,
    })
    void syncPendingFeedings()
    setSuggestedSide(side === 'left' ? 'right' : 'left')
    setStartedAt(null)
    setEndedAt(null)
    setElapsed(0)
    setMood(null)
    setNote('')
    setState('idle')
  }

  // ─── Palette ─────────────────────────────────────────────────────────────
  // Night: warm espresso + soft cream (not harsh red on black)
  // Day:   warm linen cream + deep warm brown (not clinical white)
  const c = night
    ? {
        bg: 'bg-[#1a1410]',
        text: 'text-[#d4b896]',
        muted: 'text-[#d4b896]/55',
        soft: 'text-[#d4b896]/75',
        ring: 'border-[#d4b896]/25',
        ringStrong: 'border-[#d4b896]/50',
        hoverFill: 'active:bg-[#d4b896]/10',
        cardBg: 'bg-[#241c17]',
        cardBorder: 'border-[#d4b896]/15',
        inputBg: 'bg-[#241c17]',
        accent: 'bg-[#c89878]',
        accentText: 'text-[#1a1410]',
        emojiSelectedBg: 'bg-[#d4b896]/15',
        emojiSelectedRing: 'ring-[#d4b896]/50',
        emojiBg: 'bg-[#241c17]',
      }
    : {
        bg: 'bg-[#f7f2e9]',
        text: 'text-[#2c241e]',
        muted: 'text-[#2c241e]/55',
        soft: 'text-[#2c241e]/75',
        ring: 'border-[#2c241e]/15',
        ringStrong: 'border-[#2c241e]/40',
        hoverFill: 'active:bg-[#2c241e]/5',
        cardBg: 'bg-[#efe7d7]',
        cardBorder: 'border-[#2c241e]/10',
        inputBg: 'bg-white',
        accent: 'bg-[#b07050]',
        accentText: 'text-[#f7f2e9]',
        emojiSelectedBg: 'bg-[#2c241e]/8',
        emojiSelectedRing: 'ring-[#2c241e]/40',
        emojiBg: 'bg-[#efe7d7]',
      }

  // ─── IDLE ────────────────────────────────────────────────────────────────
  if (state === 'idle') {
    return (
      <main className={`min-h-screen flex flex-col ${c.bg} ${c.text}`}>
        <header className="px-6 pt-6 pb-2 flex items-center justify-between">
          <h1
            className={`text-base font-light tracking-[0.32em] uppercase ${c.soft}`}
          >
            Latch
          </h1>
        </header>

        {checkin && !checkinCollapsed && (
          <div className="px-6 mt-4">
            <div className={`rounded-3xl p-5 border ${c.cardBg} ${c.cardBorder}`}>
              <div className={`text-xs tracking-[0.2em] uppercase mb-2 ${c.muted}`}>
                Bonjour
              </div>
              <p className="text-base leading-relaxed mb-4">{checkin.message}</p>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-xs italic ${c.muted}`}>
                  Ces messages ne remplacent pas l&apos;avis d&apos;un
                  professionnel de santé.
                </span>
                <button
                  onClick={markCheckinRead}
                  className={`text-xs underline underline-offset-2 shrink-0 ${c.soft}`}
                >
                  Lu
                </button>
              </div>
            </div>
          </div>
        )}

        {checkin && checkinCollapsed && (
          <div className="px-6 mt-4">
            <button
              onClick={expandCheckin}
              aria-label="Rouvrir le check-in du matin"
              className={`w-full flex items-center justify-between rounded-full px-5 py-3 border ${c.cardBg} ${c.cardBorder} ${c.soft}`}
            >
              <span className="text-xs tracking-[0.2em] uppercase">
                ✓ Check-in du matin lu
              </span>
              <span aria-hidden className="text-base leading-none">⌄</span>
            </button>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="flex gap-3 w-60">
            {(['left', 'right'] as const).map((s) => {
              const active = suggestedSide === s
              return (
                <button
                  key={s}
                  onClick={() => setSuggestedSide(s)}
                  aria-pressed={active}
                  className={`flex-1 rounded-full py-3 text-sm font-light tracking-[0.2em] uppercase border-2 transition-colors ${
                    active
                      ? `${c.accent} ${c.accentText} border-transparent`
                      : `${c.ringStrong} ${c.text} ${c.hoverFill}`
                  }`}
                >
                  {labelSide(s)}
                </button>
              )
            })}
          </div>

          <button
            onClick={startFeeding}
            aria-label={`Démarrer une tétée côté ${labelSide(suggestedSide)}`}
            className={`w-60 h-60 rounded-full border-2 flex items-center justify-center text-2xl font-light tracking-wide transition-colors ${c.ringStrong} ${c.text} ${c.hoverFill}`}
          >
            Démarrer
          </button>
        </div>

        <footer className={`text-center pb-6 text-xs tracking-[0.2em] uppercase ${c.muted}`}>
          {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
        </footer>
      </main>
    )
  }

  // ─── ACTIVE ──────────────────────────────────────────────────────────────
  if (state === 'active') {
    return (
      <main className={`min-h-screen flex flex-col items-center justify-center ${c.bg}`}>
        <div className={`text-xs tracking-[0.32em] uppercase mb-10 ${c.muted}`}>
          Côté&nbsp;·&nbsp;{labelSide(side)}
        </div>
        <div
          className={`text-8xl font-light tabular-nums mb-20 tracking-tight ${c.text}`}
        >
          {formatTime(elapsed)}
        </div>
        <button
          onClick={stopFeeding}
          aria-label="Arrêter la tétée"
          className={`w-36 h-36 rounded-full border-2 text-xl font-light tracking-wide transition-colors ${c.ringStrong} ${c.text} ${c.hoverFill}`}
        >
          Stop
        </button>
      </main>
    )
  }

  // ─── DONE ────────────────────────────────────────────────────────────────
  return (
    <main className={`min-h-screen flex flex-col p-6 ${c.bg} ${c.text}`}>
      <div className="flex-1 flex flex-col justify-center max-w-md w-full mx-auto">
        <p className={`text-xs tracking-[0.32em] uppercase mb-2 ${c.muted}`}>
          Tétée enregistrée
        </p>
        <p className="text-3xl font-light mb-12 tabular-nums">
          {formatTime(elapsed)}
          <span className={`mx-3 ${c.muted}`}>·</span>
          <span className="font-normal">{labelSide(side)}</span>
        </p>

        <p className={`text-sm mb-4 ${c.soft}`}>Comment tu te sens&nbsp;?</p>
        <div className="flex gap-3 mb-8">
          {(['😊', '😐', '😣'] as const).map((emoji) => (
            <button
              key={emoji}
              onClick={() => setMood(emoji)}
              className={`flex-1 text-4xl py-5 rounded-3xl transition-all ${
                mood === emoji
                  ? `${c.emojiSelectedBg} ring-2 ${c.emojiSelectedRing}`
                  : `${c.emojiBg} ${c.hoverFill}`
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Une note pour toi-même…"
          rows={3}
          className={`rounded-3xl border p-4 text-base resize-none mb-8 focus:outline-none focus:ring-2 ${c.inputBg} ${c.cardBorder} ${c.text} placeholder:opacity-40`}
        />

        <div className="flex gap-3">
          <button
            onClick={() => persistAndReset(true)}
            className={`flex-1 rounded-full py-4 text-base font-light tracking-wide transition-colors ${c.accent} ${c.accentText} active:opacity-80`}
          >
            Sauvegarder
          </button>
          <button
            onClick={() => persistAndReset(false)}
            className={`rounded-full py-4 px-6 text-sm font-light tracking-wide transition-colors border ${c.cardBorder} ${c.soft} ${c.hoverFill}`}
          >
            Skip
          </button>
        </div>
      </div>
    </main>
  )
}

function labelSide(s: Side): string {
  return s === 'left' ? 'gauche' : 'droit'
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
