'use client'

import { useEffect, useState } from 'react'
import { useNightMode } from '@/lib/hooks/useNightMode'
import { db } from '@/lib/db'

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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const last = await db.feedings.orderBy('startedAt').reverse().first()
      if (!cancelled && last) {
        setSuggestedSide(last.side === 'left' ? 'right' : 'left')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
      startedAt,
      endedAt,
      side,
      mood: withMood ? mood : null,
      note: withMood ? note.trim() : '',
      synced: false,
    })
    setSuggestedSide(side === 'left' ? 'right' : 'left')
    setStartedAt(null)
    setEndedAt(null)
    setElapsed(0)
    setMood(null)
    setNote('')
    setState('idle')
  }

  if (state === 'idle') {
    return (
      <main
        className={`min-h-screen flex flex-col ${
          night ? 'bg-black text-[#8B0000]' : 'bg-white text-neutral-900'
        }`}
      >
        <div
          className={`px-6 pt-8 text-sm ${
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
