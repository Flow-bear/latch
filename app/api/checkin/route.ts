import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { buildMorningCheckinSystem } from '@/lib/prompts'
import { PROFILE_COLUMNS, type Profile } from '@/lib/profile'
import { formatFeedings24h, summary7d, type FeedingRow } from '@/lib/feeding-stats'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

const anthropic = new Anthropic()

function localDateFor(now: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(now) // YYYY-MM-DD
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const now = new Date()

  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .not('onboarded_at', 'is', null)

  if (profilesErr) {
    return NextResponse.json({ error: profilesErr.message }, { status: 500 })
  }

  // Vercel Hobby caps at 1 cron/day. We process every onboarded profile on
  // each firing and rely on the unique (user_id, for_date) constraint for
  // idempotency. When upgrading to Pro, restore:
  // filter((p) => localHourFor(now, p.timezone) === 9)
  const targets = (profiles ?? []) as Profile[]

  let generated = 0
  for (const profile of targets) {
    const today = localDateFor(now, profile.timezone)

    const { data: existing } = await supabaseAdmin
      .from('morning_checkins')
      .select('id')
      .eq('user_id', profile.id)
      .eq('for_date', today)
      .maybeSingle()
    if (existing) continue

    const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString()
    const since7d = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()

    const { data: feedings24h } = await supabaseAdmin
      .from('feedings')
      .select('started_at, ended_at, side, mood_emoji, note')
      .eq('user_id', profile.id)
      .gte('started_at', since24h)
      .order('started_at', { ascending: true })

    const { data: feedings7d } = await supabaseAdmin
      .from('feedings')
      .select('started_at, ended_at, side')
      .eq('user_id', profile.id)
      .gte('started_at', since7d)

    const rows24h = (feedings24h ?? []) as FeedingRow[]
    const rows7d = (feedings7d ?? []) as FeedingRow[]

    if (rows24h.length === 0) continue

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 256,
        system: buildMorningCheckinSystem(profile),
        messages: [
          {
            role: 'user',
            content: `DONNÉES 24H :\n${formatFeedings24h(rows24h, profile.timezone)}\n\nMOYENNES 7 JOURS :\n${summary7d(rows7d)}`,
          },
        ],
      })

      const message = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()

      if (!message) continue

      await supabaseAdmin
        .from('morning_checkins')
        .insert({ user_id: profile.id, for_date: today, message })
      generated++
    } catch (e) {
      console.error('checkin error for', profile.id, e)
    }
  }

  return NextResponse.json({ generated, scanned: profiles?.length ?? 0 })
}
