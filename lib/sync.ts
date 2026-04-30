import { db } from '@/lib/db'
import { createClient } from '@/lib/supabase/client'

export async function syncPendingFeedings(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 0

  const pending = (await db.feedings.toArray()).filter((f) => !f.synced)
  if (pending.length === 0) return 0

  const rows = pending.map((f) => ({
    user_id: user.id,
    client_id: f.clientId,
    started_at: f.startedAt.toISOString(),
    ended_at: f.endedAt.toISOString(),
    side: f.side,
    mood_emoji: f.mood,
    note: f.note,
  }))

  const { error } = await supabase
    .from('feedings')
    .upsert(rows, { onConflict: 'user_id,client_id' })

  if (error) {
    console.error('sync failed', error.message)
    return 0
  }

  await Promise.all(
    pending.map((f) => db.feedings.update(f.id!, { synced: true }))
  )
  return pending.length
}
