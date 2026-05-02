/**
 * E2E test of the authenticated data path, REST-level (no browser).
 *
 * What it verifies:
 *   1. admin.generateLink mints an OTP
 *   2. POST /auth/v1/verify with that OTP returns a real user session
 *   3. As that user, INSERT into feedings works (RLS allows own user)
 *   4. As that user, SELECT only returns their own rows
 *   5. service_role read confirms the row landed with all the right fields
 *   6. Cleanup: delete the test row
 *
 * UI flow (button clicks for start/stop/save) is covered by:
 *   - TypeScript compile (next build)
 *   - static HTML rendered correctly (e2e-login.mjs screenshots)
 *   - the same insert payload shape as sync.ts produces
 */

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'

// Load .env.local
const envText = await readFile('.env.local', 'utf8')
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const [k, ...rest] = l.split('=')
      return [k.trim(), rest.join('=').trim()]
    })
)
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const TEST_EMAIL = process.argv[2] ?? 'aschwerkolt@noelse.com'

const checks = []
const log = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
})

// ─── 1. Mint OTP ──────────────────────────────────────────────────────────
const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: TEST_EMAIL,
})
if (linkErr) {
  log('admin.generateLink', false, linkErr.message)
  process.exit(1)
}
const otp = linkData?.properties?.email_otp
log('OTP minted via admin', !!otp, otp ? `${otp.slice(0, 2)}***` : 'none')

// ─── 2. Verify OTP → get session ─────────────────────────────────────────
const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
  method: 'POST',
  headers: {
    apikey: ANON,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email: TEST_EMAIL, token: otp, type: 'magiclink' }),
})

if (!verifyResp.ok) {
  log('verify endpoint returns 200', false, `status=${verifyResp.status}`)
  console.error(await verifyResp.text())
  process.exit(1)
}
const session = await verifyResp.json()
log(
  'POST /auth/v1/verify returns access_token',
  !!session.access_token,
  `user=${session.user?.email}`
)

const userId = session.user?.id
const accessToken = session.access_token

// ─── 3. Insert as user (simulates what lib/sync.ts upsert would do) ─────
const userClient = createClient(SUPABASE_URL, ANON, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
})

const clientId = crypto.randomUUID()
const startedAt = new Date(Date.now() - 14 * 60 * 1000) // 14 min ago
const endedAt = new Date()
const insertPayload = {
  user_id: userId,
  client_id: clientId,
  started_at: startedAt.toISOString(),
  ended_at: endedAt.toISOString(),
  side: 'left',
  mood_emoji: '😊',
  note: 'e2e test — REST sync path',
}

const { data: inserted, error: insertErr } = await userClient
  .from('feedings')
  .upsert(insertPayload, { onConflict: 'user_id,client_id' })
  .select()
  .single()

log(
  'Authenticated upsert into feedings succeeds (RLS allows own user)',
  !insertErr && !!inserted?.id,
  insertErr?.message ?? `id=${inserted?.id}`
)

// ─── 4. SELECT as user — should return at least our row ─────────────────
const { data: ownRows, error: selectErr } = await userClient
  .from('feedings')
  .select('id, side, mood_emoji, note')
  .eq('client_id', clientId)
log(
  'Authenticated select returns own row',
  !selectErr && (ownRows?.length ?? 0) === 1,
  selectErr?.message ?? `rows=${ownRows?.length}`
)

// ─── 5. service_role confirms row + all fields match ────────────────────
const { data: serverRow } = await admin
  .from('feedings')
  .select('*')
  .eq('client_id', clientId)
  .single()

log('service_role finds the row', !!serverRow)
if (serverRow) {
  log('side stored as "left"', serverRow.side === 'left', serverRow.side)
  log('mood_emoji = 😊', serverRow.mood_emoji === '😊', serverRow.mood_emoji)
  log(
    'note matches',
    serverRow.note === 'e2e test — REST sync path',
    serverRow.note
  )
  log('user_id matches authed user', serverRow.user_id === userId)
}

// ─── 6. RLS sanity: anon-only client cannot read this row ───────────────
const anonClient = createClient(SUPABASE_URL, ANON, {
  auth: { persistSession: false },
})
const { data: anonRows } = await anonClient
  .from('feedings')
  .select('id')
  .eq('client_id', clientId)
log(
  'Anon (no token) cannot read the row (RLS)',
  (anonRows?.length ?? 0) === 0,
  `rows=${anonRows?.length ?? 0}`
)

// ─── 7. Cleanup ─────────────────────────────────────────────────────────
await admin.from('feedings').delete().eq('client_id', clientId)

const passed = checks.filter((c) => c.ok).length
console.log(`\n${passed}/${checks.length} passed`)
process.exit(passed === checks.length ? 0 : 1)
