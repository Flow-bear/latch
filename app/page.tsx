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
      if (!cancelled && data) setCheckin(data)
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

  async function dismissCheckin() {
    if (!checkin) return
    const supabase = createClient()
    await supabase
      .from('morning_checkins')
      .update({ read_at: new Date().toISOString() })
      .eq('id', checkin.id)
    setCheckin(null)
  }

  useEffect(() => {
    if (state !== 'active' || !startedAt) return
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.getTime()) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [state, startedAt])

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

  if (state === 'idle') {
    const showCheckin = checkin && !checkin.read_at
    return (
      <main
        className={`min-h-screen flex flex-col ${
          night ? 'bg-black text-[#8B0000]' : 'bg-white text-neutral-900'
        }`}
      >
        {showCheckin && (
          <div className="px-6 pt-6">
            <div
              className={`rounded-2xl p-5 ${
                night
                  ? 'border border-[#8B0000]/40 bg-black'
                  : 'bg-neutral-100'
              }`}
            >
              <div
                className={`text-xs uppercase tracking-wide mb-2 ${
                  night ? 'text-[#8B0000]/60' : 'text-neutral-500'
                }`}
              >
                Bonjour
              </div>
              <p className="text-base leading-relaxed mb-4">
                {checkin.message}
              </p>
              <div className="flex items-center justify-between gap-3">
                <span
                  className={`text-xs italic ${
                    night ? 'text-[#8B0000]/50' : 'text-neutral-400'
                  }`}
                >
                  Ces messages ne remplacent pas l&apos;avis d&apos;un
                  professionnel de santé.
                </span>
                <button
                  onClick={dismissCheckin}
                  className={`text-sm underline underline-offset-2 shrink-0 ${
                    night ? 'text-[#8B0000]/80' : 'text-neutral-600'
                  }`}
                >
                  Lu
                </button>
              </div>
            </div>
          </div>
        )}
        <div
          className={`px-6 pt-6 text-sm ${
            night ? 'text-[#8B0000]/70' : 'text-neutral-500'
          }`}
        >
          Côté suggéré&nbsp;:{' '}
          <span
            className={`font-medium ${
              night ? 'text-[#8B0000]' : 'text-neutral-900'
            }`}
          >
            {labelSide(suggestedSide)}
          </span>
          <button
            onClick={() =>
              setSuggestedSide(suggestedSide === 'left' ? 'right' : 'left')
            }
            className="ml-3 underline underline-offset-2"
          >
            changer
          </button>
        </div>
        <button
          onClick={startFeeding}
          className={`flex-1 m-6 rounded-3xl text-4xl font-medium transition-colors ${
            night
              ? 'border-2 border-[#8B0000] text-[#8B0000] active:bg-[#8B0000]/10'
              : 'bg-neutral-900 text-white active:bg-neutral-700'
          }`}
        >
          Démarrer tétée
        </button>
      </main>
    )
  }

  if (state === 'active') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-black">
        <div
          className={`text-sm uppercase tracking-widest mb-6 ${
            night ? 'text-[#8B0000]/70' : 'text-white/60'
          }`}
        >
          {labelSide(side)}
        </div>
        <div
          className={`text-8xl font-light tabular-nums mb-16 ${
            night ? 'text-[#8B0000]' : 'text-white'
          }`}
        >
          {formatTime(elapsed)}
        </div>
        <button
          onClick={stopFeeding}
          className={`rounded-full text-2xl font-medium px-20 py-7 transition-colors ${
            night
              ? 'border-2 border-[#8B0000] text-[#8B0000] active:bg-[#8B0000]/10'
              : 'bg-red-600 text-white active:bg-red-700'
          }`}
        >
          Stop
        </button>
      </main>
    )
  }

  return (
    <main
      className={`min-h-screen flex flex-col p-6 ${
        night ? 'bg-black text-[#8B0000]' : 'bg-white text-neutral-900'
      }`}
    >
      <div
        className={`text-sm mb-1 ${
          night ? 'text-[#8B0000]/70' : 'text-neutral-500'
        }`}
      >
        Tétée enregistrée
      </div>
      <div className="text-2xl font-medium mb-10">
        {formatTime(elapsed)} · {labelSide(side)}
      </div>
      <div
        className={`text-lg mb-4 ${
          night ? 'text-[#8B0000]/80' : 'text-neutral-700'
        }`}
      >
        Comment tu te sens&nbsp;?
      </div>
      <div className="flex gap-3 mb-8">
        {(['😊', '😐', '😣'] as const).map((emoji) => (
          <button
            key={emoji}
            onClick={() => setMood(emoji)}
            className={`flex-1 text-5xl py-6 rounded-2xl transition-colors ${
              mood === emoji
                ? night
                  ? 'bg-[#8B0000]/20 ring-2 ring-[#8B0000]'
                  : 'bg-neutral-900 ring-2 ring-neutral-900'
                : night
                  ? 'bg-neutral-950 active:bg-neutral-900'
                  : 'bg-neutral-100 active:bg-neutral-200'
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optionnel)"
        className={`rounded-2xl border p-4 text-base resize-none mb-8 focus:outline-none focus:ring-2 ${
          night
            ? 'bg-black border-[#8B0000]/40 text-[#8B0000] placeholder-[#8B0000]/40 focus:ring-[#8B0000]'
            : 'border-neutral-200 focus:ring-neutral-900'
        }`}
        rows={3}
      />
      <div className="flex gap-3 mt-auto">
        <button
          onClick={() => persistAndReset(true)}
          className={`flex-1 rounded-2xl py-4 text-lg font-medium transition-colors ${
            night
              ? 'border-2 border-[#8B0000] text-[#8B0000] active:bg-[#8B0000]/10'
              : 'bg-neutral-900 text-white active:bg-neutral-700'
          }`}
        >
          Sauvegarder
        </button>
        <button
          onClick={() => persistAndReset(false)}
          className={`rounded-2xl py-4 px-6 text-lg transition-colors ${
            night
              ? 'border border-[#8B0000]/40 text-[#8B0000]/70 active:bg-[#8B0000]/10'
              : 'bg-neutral-100 text-neutral-600 active:bg-neutral-200'
          }`}
        >
          Skip
        </button>
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
