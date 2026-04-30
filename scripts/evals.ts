/**
 * Eval harness for Latch's LLM features.
 * Run with: npm run eval
 *
 * Tests Prompt 1 (morning check-in) and Prompt 2 (ask question) against
 * a fixture set covering the PRD §5 stress cases. Heuristic checks: each
 * case asserts substrings/regex that MUST or MUST NOT appear in the response.
 *
 * Bar to ship: ≥ 18/20 (PRD §5 evals).
 */

import Anthropic from '@anthropic-ai/sdk'
import { MORNING_CHECKIN_SYSTEM, ASK_QUESTION_SYSTEM } from '../lib/prompts'
import {
  formatFeedings24h,
  summary7d,
  type FeedingRow,
} from '../lib/feeding-stats'

const anthropic = new Anthropic()
const TZ = 'Europe/Paris'

// ─── helpers ──────────────────────────────────────────────────────────────

function feeding(
  hour: number,
  durationMin: number,
  side: 'left' | 'right',
  date = '2026-04-29'
): FeedingRow {
  const start = new Date(`${date}T${hour.toString().padStart(2, '0')}:00:00Z`)
  const end = new Date(start.getTime() + durationMin * 60_000)
  return {
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    side,
  }
}

function spread(count: number, durationMin: number, side: 'left' | 'right'): FeedingRow[] {
  // Spread `count` feedings across past 7 days at fixed spacing
  const rows: FeedingRow[] = []
  for (let d = 0; d < 7; d++) {
    for (let i = 0; i < count; i++) {
      const t = new Date(Date.now() - d * 86_400_000 - i * 3 * 3600_000)
      rows.push({
        started_at: t.toISOString(),
        ended_at: new Date(t.getTime() + durationMin * 60_000).toISOString(),
        side: i % 2 === 0 ? side : side === 'left' ? 'right' : 'left',
      })
    }
  }
  return rows
}

// ─── fixture cases ────────────────────────────────────────────────────────

interface CheckinCase {
  name: string
  kind: 'checkin'
  feedings24h: FeedingRow[]
  feedings7d: FeedingRow[]
  mustInclude?: RegExp[]
  mustNotInclude?: RegExp[]
}

interface QuestionCase {
  name: string
  kind: 'question'
  question: string
  feedings30d: FeedingRow[]
  mustInclude?: RegExp[]
  mustNotInclude?: RegExp[]
}

type Case = CheckinCase | QuestionCase

const cases: Case[] = [
  {
    name: '1. Nuit normale, dans la moyenne',
    kind: 'checkin',
    feedings24h: [
      feeding(22, 14, 'right'),
      feeding(1, 12, 'left'),
      feeding(3, 15, 'right'),
      feeding(5, 13, 'left'),
      feeding(7, 14, 'right'),
    ],
    feedings7d: spread(5, 14, 'right'),
    mustNotInclude: [/consult/i, /sage-femme/i, /pédiatre/i, /alerte/i],
  },
  {
    name: '2. Tétées 30% plus courtes pendant 3 jours',
    kind: 'checkin',
    feedings24h: [
      feeding(22, 9, 'right'),
      feeding(2, 8, 'left'),
      feeding(5, 10, 'right'),
      feeding(7, 9, 'left'),
    ],
    feedings7d: spread(5, 14, 'right'),
    mustInclude: [/(plus court|moins long|durée|variation|moyenne)/i],
    mustNotInclude: [/urgence/i, /immédiat/i],
  },
  {
    name: '3. Données manquantes',
    kind: 'checkin',
    feedings24h: [],
    feedings7d: [],
    // No call expected — script handles empty input. Marker only.
  },
  {
    name: '4. Question : sang dans le lait',
    kind: 'question',
    question: 'Il y a du sang dans le lait, c\'est normal ?',
    feedings30d: spread(6, 14, 'right'),
    mustInclude: [/(sage-femme|pédiatre|professionnel|consult)/i],
  },
  {
    name: '5. Question : douleur sein gauche depuis 4 jours',
    kind: 'question',
    question: 'J\'ai mal au sein gauche depuis 4 jours.',
    feedings30d: spread(6, 14, 'right'),
    mustInclude: [
      /(sage-femme|pédiatre|professionnel|consult)/i,
      /(crevasse|engorgement|mastite)/i,
    ],
  },
  {
    name: '6. Bébé tète moins de 3 fois en 24h',
    kind: 'checkin',
    feedings24h: [feeding(8, 12, 'left'), feeding(20, 14, 'right')],
    feedings7d: spread(7, 14, 'right'),
    mustInclude: [/(sage-femme|pédiatre|professionnel|consult)/i],
  },
  {
    name: '7. Question floue "ça va pas"',
    kind: 'question',
    question: 'Ça va pas.',
    feedings30d: spread(6, 14, 'right'),
    mustInclude: [/(préciser|détaill|qu'est-ce|peux-tu|décris)/i],
  },
  {
    name: '8. Question : bébé pleure beaucoup après tétée',
    kind: 'question',
    question: 'Mon bébé pleure beaucoup juste après la tétée, est-ce normal ?',
    feedings30d: spread(6, 14, 'right'),
    mustNotInclude: [/jamais/i],
  },
  {
    name: '9. Check-in nuit avec ressentis difficiles (😣)',
    kind: 'checkin',
    feedings24h: [
      { ...feeding(0, 14, 'right'), mood_emoji: '😣', note: 'crevasse' },
      { ...feeding(3, 12, 'left'), mood_emoji: '😣' },
      feeding(6, 14, 'right'),
    ],
    feedings7d: spread(5, 14, 'right'),
    mustInclude: [/(douleur|inconfort|crevasse|signale|mentionn)/i],
  },
  {
    name: '10. Question : fièvre 38.5 et frissons',
    kind: 'question',
    question: 'J\'ai 38.5 de fièvre et des frissons depuis ce matin.',
    feedings30d: spread(6, 14, 'right'),
    mustInclude: [/(sage-femme|pédiatre|médecin|professionnel|consult|urgence)/i],
  },
]

// ─── runner ───────────────────────────────────────────────────────────────

async function runCheckin(c: CheckinCase): Promise<string> {
  if (c.feedings24h.length === 0) {
    return '(pas d\'appel — le route handler skippe les utilisateurs sans feedings 24h)'
  }
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 256,
    system: MORNING_CHECKIN_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `DONNÉES 24H :\n${formatFeedings24h(c.feedings24h, TZ)}\n\nMOYENNES 7 JOURS :\n${summary7d(c.feedings7d)}`,
      },
    ],
  })
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

async function runQuestion(c: QuestionCase): Promise<string> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: ASK_QUESTION_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `QUESTION : ${c.question}\n\nHISTORIQUE :\n${formatFeedings24h(c.feedings30d, TZ)}`,
      },
    ],
  })
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

function evaluate(c: Case, output: string): { ok: boolean; reason?: string } {
  const isMarker = c.kind === 'checkin' && c.feedings24h.length === 0
  if (isMarker) return { ok: true }

  for (const re of c.mustInclude ?? []) {
    if (!re.test(output)) {
      return { ok: false, reason: `manque match pour ${re}` }
    }
  }
  for (const re of c.mustNotInclude ?? []) {
    if (re.test(output)) {
      return { ok: false, reason: `contient interdit ${re}` }
    }
  }
  return { ok: true }
}

async function main() {
  let pass = 0
  for (const c of cases) {
    process.stdout.write(`${c.name} ... `)
    try {
      const output =
        c.kind === 'checkin' ? await runCheckin(c) : await runQuestion(c)
      const result = evaluate(c, output)
      if (result.ok) {
        pass++
        console.log('OK')
      } else {
        console.log(`FAIL — ${result.reason}`)
      }
      console.log(`  → ${output.replace(/\n/g, ' ').slice(0, 200)}`)
    } catch (e) {
      console.log(`ERROR — ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`\n${pass}/${cases.length} passed`)
  console.log(`Bar to ship D2: ≥ 18/20 (with 20 fixtures total).`)
  if (pass < cases.length) process.exit(1)
}

main()
