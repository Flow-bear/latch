// French human-readable age and duration formatters.
// Used by both the LLM prompt builder and the onboarding/settings UI.

const MS_PER_DAY = 24 * 3600 * 1000

function diffDays(from: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / MS_PER_DAY))
}

/**
 * "3 jours", "2 semaines", "1 mois et demi", "4 mois", "1 an", "2 ans".
 * Granularity: days < 14, weeks < 56 (~8 weeks), months < 365, then years.
 */
export function formatAge(birthDate: Date, now: Date = new Date()): string {
  const days = diffDays(birthDate, now)

  if (days < 14) {
    if (days === 0) return "aujourd'hui"
    if (days === 1) return '1 jour'
    return `${days} jours`
  }

  if (days < 56) {
    const weeks = Math.floor(days / 7)
    return weeks === 1 ? '1 semaine' : `${weeks} semaines`
  }

  if (days < 365) {
    const months = Math.floor(days / 30)
    const remainder = days - months * 30
    const halfMonth = remainder >= 12 && remainder <= 18
    if (halfMonth) {
      return months === 1 ? '1 mois et demi' : `${months} mois et demi`
    }
    return months === 1 ? '1 mois' : `${months} mois`
  }

  const years = Math.floor(days / 365)
  return years === 1 ? '1 an' : `${years} ans`
}

/** Same scale as formatAge — used for "tu allaites depuis X". */
export function formatDuration(startDate: Date, now: Date = new Date()): string {
  return formatAge(startDate, now)
}
