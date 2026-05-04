'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useNightMode } from '@/lib/hooks/useNightMode'
import { getPalette } from '@/lib/palette'
import { createClient } from '@/lib/supabase/client'
import { db } from '@/lib/db'
import { FeedingModal, type Feeding, type Side } from './FeedingModal'

const PAGE_SIZE = 30

type Editing = Feeding | 'new' | null

export default function HistoriquePage() {
  const night = useNightMode()
  const c = getPalette(night)

  const [feedings, setFeedings] = useState<Feeding[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [timezone, setTimezone] = useState('Europe/Paris')
  const [online, setOnline] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  // Online tracking
  useEffect(() => {
    setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Initial load
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || cancelled) return
      setUserId(user.id)

      const { data: profile } = await supabase
        .from('profiles')
        .select('timezone')
        .eq('id', user.id)
        .maybeSingle()
      if (cancelled) return
      if (profile?.timezone) setTimezone(profile.timezone)

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const { data, error } = await supabase
          .from('feedings')
          .select('id, started_at, ended_at, side, mood_emoji, note')
          .order('started_at', { ascending: false })
          .range(0, PAGE_SIZE - 1)
        if (cancelled) return
        if (!error && data) {
          setFeedings(data as Feeding[])
          setHasMore(data.length === PAGE_SIZE)
        }
      } else {
        // Offline fallback: read whatever we have in Dexie (synced + pending)
        const local = await db.feedings.orderBy('startedAt').reverse().toArray()
        if (cancelled) return
        setFeedings(
          local.map((f) => ({
            id: `local:${f.clientId}`,
            started_at: f.startedAt.toISOString(),
            ended_at: f.endedAt ? f.endedAt.toISOString() : null,
            side: f.side as Side,
            mood_emoji: f.mood,
            note: f.note,
          }))
        )
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function loadMore() {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    const supabase = createClient()
    const { data, error } = await supabase
      .from('feedings')
      .select('id, started_at, ended_at, side, mood_emoji, note')
      .order('started_at', { ascending: false })
      .range(feedings.length, feedings.length + PAGE_SIZE - 1)
    if (!error && data) {
      setFeedings((prev) => [...prev, ...(data as Feeding[])])
      setHasMore(data.length === PAGE_SIZE)
    }
    setLoadingMore(false)
  }

  // ─── Mutations (optimistic) ────────────────────────────────────────────
  async function handleSave(
    payload: Omit<Feeding, 'id'>,
    originalId: string | null
  ) {
    if (!userId) return
    const supabase = createClient()

    if (originalId === null) {
      // INSERT — wait for response so we get the real id
      const { data, error } = await supabase
        .from('feedings')
        .insert({
          user_id: userId,
          client_id: crypto.randomUUID(),
          ...payload,
        })
        .select('id, started_at, ended_at, side, mood_emoji, note')
        .single()
      if (error || !data) {
        console.error('insert failed', error)
        return
      }
      setFeedings((prev) =>
        [...prev, data as Feeding].sort((a, b) =>
          b.started_at.localeCompare(a.started_at)
        )
      )
      return
    }

    // UPDATE — optimistic with rollback
    const previous = feedings.find((f) => f.id === originalId)
    setFeedings((prev) =>
      prev
        .map((f) => (f.id === originalId ? { ...f, ...payload } : f))
        .sort((a, b) => b.started_at.localeCompare(a.started_at))
    )
    const { error } = await supabase
      .from('feedings')
      .update(payload)
      .eq('id', originalId)
    if (error) {
      console.error('update failed', error)
      if (previous) {
        setFeedings((prev) =>
          prev
            .map((f) => (f.id === originalId ? previous : f))
            .sort((a, b) => b.started_at.localeCompare(a.started_at))
        )
      }
    }
  }

  async function handleDelete(id: string) {
    const supabase = createClient()
    const previous = feedings
    setFeedings((prev) => prev.filter((f) => f.id !== id))
    const { error } = await supabase.from('feedings').delete().eq('id', id)
    if (error) {
      console.error('delete failed', error)
      setFeedings(previous)
    }
  }

  // ─── Grouping ──────────────────────────────────────────────────────────
  const groups = useMemo(() => groupByDay(feedings, timezone), [feedings, timezone])

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
          Historique
        </span>
      </header>

      {!online && (
        <div
          className={`mx-6 mt-3 px-4 py-2 rounded-full text-xs ${c.cardBg} ${c.muted}`}
        >
          Hors ligne — historique limité aux tétées en attente de sync. Édition
          désactivée.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 pb-32">
        {loading && <Skeleton c={c} />}

        {!loading && feedings.length === 0 && (
          <p className={`text-center mt-24 text-sm ${c.muted}`}>
            Aucune tétée enregistrée pour le moment.
          </p>
        )}

        {!loading &&
          groups.map((g) => (
            <section key={g.dateKey} className="mt-8 first:mt-4">
              <header className="flex items-center justify-between mb-3">
                <h2
                  className={`text-xs tracking-[0.2em] uppercase ${c.muted}`}
                >
                  {g.label}
                </h2>
                <span className={`text-[11px] ${c.muted} opacity-70`}>
                  {countLabel(g.items.length)}
                </span>
              </header>
              <div className="flex flex-col gap-2">
                {g.items.map((f) => (
                  <FeedingRow
                    key={f.id}
                    feeding={f}
                    timezone={timezone}
                    c={c}
                    disabled={!online || f.id.startsWith('local:')}
                    onClick={() => setEditing(f)}
                  />
                ))}
              </div>
            </section>
          ))}

        {!loading && hasMore && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className={`mt-10 mx-auto block text-xs underline underline-offset-4 ${c.muted} disabled:opacity-50`}
          >
            {loadingMore ? '…' : 'Charger plus'}
          </button>
        )}
      </div>

      {online && !loading && (
        <button
          onClick={() => setEditing('new')}
          aria-label="Ajouter une tétée"
          className={`fixed bottom-6 right-6 w-14 h-14 rounded-full ${c.accent} ${c.accentText} text-3xl font-light shadow-lg flex items-center justify-center active:opacity-80`}
          style={{ bottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}
        >
          +
        </button>
      )}

      {editing && (
        <FeedingModal
          feeding={editing === 'new' ? null : editing}
          c={c}
          onClose={() => setEditing(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </main>
  )
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function FeedingRow({
  feeding,
  timezone,
  c,
  disabled,
  onClick,
}: {
  feeding: Feeding
  timezone: string
  c: ReturnType<typeof getPalette>
  disabled: boolean
  onClick: () => void
}) {
  const time = new Date(feeding.started_at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  })
  const dur = formatDuration(feeding)
  const sideLabel =
    feeding.side === 'left'
      ? 'Gauche'
      : feeding.side === 'right'
        ? 'Droit'
        : 'Les deux'

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border ${c.cardBg} ${c.cardBorder} text-left active:opacity-70 disabled:opacity-60 disabled:active:opacity-60`}
    >
      <span className={`text-sm font-light tabular-nums w-12 ${c.text}`}>
        {time}
      </span>
      <SideDots side={feeding.side} c={c} />
      <span className={`text-sm flex-1 ${c.soft}`}>{sideLabel}</span>
      <span className={`text-sm tabular-nums ${c.text}`}>{dur}</span>
      {feeding.mood_emoji && (
        <span className="text-base ml-1">{feeding.mood_emoji}</span>
      )}
    </button>
  )
}

function SideDots({ side, c }: { side: Side; c: ReturnType<typeof getPalette> }) {
  const left = side === 'left' || side === 'both'
  const right = side === 'right' || side === 'both'
  return (
    <span className="inline-flex gap-1 shrink-0" aria-hidden>
      <Dot active={left} c={c} />
      <Dot active={right} c={c} />
    </span>
  )
}

function Dot({ active, c }: { active: boolean; c: ReturnType<typeof getPalette> }) {
  return (
    <span
      className={`w-2.5 h-2.5 rounded-full ${active ? c.accent : ''}`}
      style={
        active ? undefined : { backgroundColor: 'currentColor', opacity: 0.18 }
      }
    />
  )
}

function Skeleton({ c }: { c: ReturnType<typeof getPalette> }) {
  return (
    <div className="mt-6 flex flex-col gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`h-12 rounded-2xl ${c.cardBg} animate-pulse`}
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function localDateKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

function dayLabel(dateKey: string, tz: string): string {
  const todayKey = localDateKey(new Date().toISOString(), tz)
  const yesterdayKey = localDateKey(
    new Date(Date.now() - 86_400_000).toISOString(),
    tz
  )
  if (dateKey === todayKey) return "Aujourd'hui"
  if (dateKey === yesterdayKey) return 'Hier'
  // Render at noon UTC to avoid TZ slippage on date boundaries
  const d = new Date(dateKey + 'T12:00:00Z')
  const sameYear = new Date().getFullYear() === d.getUTCFullYear()
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  })
}

function groupByDay(
  feedings: Feeding[],
  tz: string
): { dateKey: string; label: string; items: Feeding[] }[] {
  const groups = new Map<string, Feeding[]>()
  for (const f of feedings) {
    const key = localDateKey(f.started_at, tz)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({ dateKey: key, label: dayLabel(key, tz), items }))
}

function countLabel(n: number): string {
  if (n === 0) return 'Aucune tétée'
  if (n === 1) return '1 tétée'
  return `${n} tétées`
}

function formatDuration(f: Feeding): string {
  if (!f.ended_at) return '—'
  const ms = new Date(f.ended_at).getTime() - new Date(f.started_at).getTime()
  const min = Math.round(ms / 60_000)
  if (min < 1) return '< 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} h` : `${h} h ${m.toString().padStart(2, '0')}`
}
