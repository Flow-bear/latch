'use client'

import { useEffect, useMemo, useState } from 'react'
import { getPalette } from '@/lib/palette'

export type Side = 'left' | 'right' | 'both'

export type Feeding = {
  id: string
  started_at: string
  ended_at: string | null
  side: Side
  mood_emoji: string | null
  note: string | null
}

type FormState = {
  started_at: string
  ended_at: string
  side: Side | null
  mood_emoji: string | null
  note: string
}

type Props = {
  feeding: Feeding | null
  c: ReturnType<typeof getPalette>
  onClose: () => void
  onSave: (payload: Omit<Feeding, 'id'>, originalId: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const NOTE_MAX = 200

// Use Intl.DateTimeFormat instead of Date.prototype getters: getHours can be
// monkey-patched (visual-preview does this to force day/night mode), and
// Intl reads the system clock directly.
const INPUT_FMT = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function isoToInput(iso: string | null): string {
  if (!iso) return ''
  const parts = INPUT_FMT.formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  // Some locales emit "24" for midnight; normalize to "00".
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

function inputToIso(local: string): string | null {
  if (!local) return null
  return new Date(local).toISOString()
}

function defaultFormForAdd(): FormState {
  const now = new Date()
  const start = new Date(now.getTime() - 30 * 60_000)
  return {
    started_at: isoToInput(start.toISOString()),
    ended_at: isoToInput(now.toISOString()),
    side: null,
    mood_emoji: null,
    note: '',
  }
}

function formFromFeeding(f: Feeding): FormState {
  return {
    started_at: isoToInput(f.started_at),
    ended_at: isoToInput(f.ended_at),
    side: f.side,
    mood_emoji: f.mood_emoji,
    note: f.note ?? '',
  }
}

export function FeedingModal({ feeding, c, onClose, onSave, onDelete }: Props) {
  const isEdit = feeding !== null
  const [form, setForm] = useState<FormState>(() =>
    feeding ? formFromFeeding(feeding) : defaultFormForAdd()
  )
  const [busy, setBusy] = useState(false)

  // Lock body scroll while modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const validation = useMemo(() => {
    if (!form.started_at) return 'L\'heure de début est obligatoire.'
    const start = new Date(form.started_at).getTime()
    if (Number.isNaN(start)) return 'Heure de début invalide.'
    if (start > Date.now()) return 'L\'heure de début ne peut pas être dans le futur.'
    if (form.ended_at) {
      const end = new Date(form.ended_at).getTime()
      if (Number.isNaN(end)) return 'Heure de fin invalide.'
      if (end <= start) return 'La fin doit être après le début.'
    }
    if (!form.side) return 'Choisis un côté.'
    if (form.note.length > NOTE_MAX) return `Note trop longue (${form.note.length}/${NOTE_MAX}).`
    return null
  }, [form])

  async function handleSave() {
    if (validation || busy) return
    setBusy(true)
    try {
      await onSave(
        {
          started_at: inputToIso(form.started_at)!,
          ended_at: inputToIso(form.ended_at),
          side: form.side!,
          mood_emoji: form.mood_emoji,
          note: form.note.trim() || null,
        },
        feeding?.id ?? null
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!feeding || busy) return
    if (!window.confirm('Supprimer cette tétée ?')) return
    setBusy(true)
    try {
      await onDelete(feeding.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-h-[92dvh] rounded-t-3xl flex flex-col ${c.bg} ${c.text}`}
      >
        {/* Drag handle */}
        <div className="pt-3 pb-1 flex justify-center">
          <span className={`block w-10 h-1 rounded-full ${c.cardBg}`} />
        </div>

        <header className="px-6 pt-2 pb-4 flex items-center justify-between">
          <h2 className={`text-base font-light tracking-[0.2em] uppercase ${c.soft}`}>
            {isEdit ? 'Modifier' : 'Ajouter'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className={`text-xl leading-none ${c.muted} active:opacity-60`}
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <div className="flex flex-col gap-6">
            <Field label="Début" c={c}>
              <input
                type="datetime-local"
                value={form.started_at}
                max={isoToInput(new Date().toISOString())}
                onChange={(e) => setForm((f) => ({ ...f, started_at: e.target.value }))}
                className={inputCls(c)}
              />
            </Field>

            <Field label="Fin (optionnel)" c={c}>
              <input
                type="datetime-local"
                value={form.ended_at}
                onChange={(e) => setForm((f) => ({ ...f, ended_at: e.target.value }))}
                className={inputCls(c)}
              />
            </Field>

            <Field label="Côté" c={c}>
              <div className="flex gap-2">
                {(
                  [
                    ['left', 'Gauche'],
                    ['right', 'Droit'],
                    ['both', 'Les deux'],
                  ] as const
                ).map(([key, label]) => {
                  const active = form.side === key
                  return (
                    <button
                      key={key}
                      onClick={() => setForm((f) => ({ ...f, side: key }))}
                      aria-pressed={active}
                      className={`flex-1 py-3 rounded-full text-xs font-light tracking-[0.15em] uppercase border-2 transition-colors ${
                        active
                          ? `${c.accent} ${c.accentText} border-transparent`
                          : `${c.ringStrong} ${c.text} ${c.hoverFill}`
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </Field>

            <Field label="Ressenti (optionnel)" c={c}>
              <div className="flex gap-2">
                {(['😊', '😐', '😣'] as const).map((e) => {
                  const active = form.mood_emoji === e
                  return (
                    <button
                      key={e}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          mood_emoji: f.mood_emoji === e ? null : e,
                        }))
                      }
                      className={`flex-1 text-2xl py-3 rounded-2xl transition-colors ${
                        active
                          ? `${c.emojiSelectedBg} ring-2 ${c.emojiSelectedRing}`
                          : `${c.emojiBg} ${c.hoverFill}`
                      }`}
                    >
                      {e}
                    </button>
                  )
                })}
                <button
                  onClick={() => setForm((f) => ({ ...f, mood_emoji: null }))}
                  aria-pressed={form.mood_emoji === null}
                  className={`flex-1 py-3 rounded-2xl text-xs font-light tracking-[0.15em] uppercase border-2 ${
                    form.mood_emoji === null
                      ? `${c.accent} ${c.accentText} border-transparent`
                      : `${c.ringStrong} ${c.text} ${c.hoverFill}`
                  }`}
                >
                  Aucun
                </button>
              </div>
            </Field>

            <Field label="Note (optionnel)" c={c}>
              <textarea
                value={form.note}
                onChange={(e) =>
                  setForm((f) => ({ ...f, note: e.target.value.slice(0, NOTE_MAX) }))
                }
                rows={3}
                placeholder="Une remarque pour toi-même…"
                className={`${inputCls(c)} resize-none`}
              />
              <div className={`text-xs mt-1 text-right ${c.muted}`}>
                {form.note.length}/{NOTE_MAX}
              </div>
            </Field>

            {validation && (
              <p className={`text-xs ${c.muted}`}>{validation}</p>
            )}

            {isEdit && (
              <button
                onClick={handleDelete}
                disabled={busy}
                className="mt-2 py-3 rounded-full border-2 border-[#a44] text-[#a44] text-xs font-light tracking-[0.15em] uppercase active:bg-[#a44]/10 disabled:opacity-50"
              >
                Supprimer
              </button>
            )}
          </div>
        </div>

        <footer
          className={`px-6 py-4 border-t ${c.cardBorder}`}
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
        >
          <button
            onClick={handleSave}
            disabled={!!validation || busy}
            className={`w-full py-3 rounded-full text-sm font-light tracking-[0.2em] uppercase ${c.accent} ${c.accentText} disabled:opacity-40 disabled:pointer-events-none`}
          >
            {busy ? '…' : 'Enregistrer'}
          </button>
        </footer>
      </div>
    </div>
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
      <label className={`text-sm leading-relaxed block mb-2 ${c.soft}`}>{label}</label>
      {children}
    </div>
  )
}
