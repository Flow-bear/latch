export interface FeedingRow {
  started_at: string
  ended_at: string
  side: 'left' | 'right' | 'both'
  mood_emoji?: string | null
  note?: string | null
}

function durationMinutes(f: FeedingRow): number {
  return (
    (new Date(f.ended_at).getTime() - new Date(f.started_at).getTime()) / 60000
  )
}

export function formatFeedings24h(feedings: FeedingRow[], timezone: string): string {
  if (feedings.length === 0) return '(aucune tétée)'
  return feedings
    .map((f) => {
      const time = new Date(f.started_at).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      })
      const dur = Math.round(durationMinutes(f))
      const sideLabel = f.side === 'left' ? 'gauche' : f.side === 'right' ? 'droite' : 'les deux'
      const moodPart = f.mood_emoji ? ` ${f.mood_emoji}` : ''
      const notePart = f.note ? ` "${f.note}"` : ''
      return `${time} · ${sideLabel} · ${dur} min${moodPart}${notePart}`
    })
    .join('\n')
}

export function summary7d(feedings: FeedingRow[]): string {
  if (feedings.length === 0) return '(pas de données 7 jours)'
  const days = new Set(feedings.map((f) => f.started_at.slice(0, 10)))
  const avgPerDay = feedings.length / Math.max(days.size, 1)
  const avgDuration =
    feedings.reduce((acc, f) => acc + durationMinutes(f), 0) / feedings.length
  const leftCount = feedings.filter((f) => f.side === 'left').length
  return `${avgPerDay.toFixed(1)} tétées/jour · durée moyenne ${avgDuration.toFixed(0)} min · ${leftCount}/${feedings.length} côté gauche`
}
