/**
 * Full browser E2E: real Chromium, real authenticated session, real UI flow.
 *
 * Bypasses email delivery by minting an OTP via admin, then injecting the
 * resulting session as @supabase/ssr-formatted cookies into Playwright.
 *
 * Flow tested:
 *   1. Inject session cookie → middleware lets / through (no redirect to /login)
 *   2. Click "Démarrer tétée" → active screen with timer
 *   3. Wait 4 seconds → click "Stop" → done screen
 *   4. Pick mood + note + Sauvegarder → returns to idle
 *   5. Wait for IndexedDB → Supabase sync (in-page lib/sync.ts)
 *   6. Verify the row landed via service_role
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { mkdir, readFile } from 'node:fs/promises'
import { stringToBase64URL } from '@supabase/ssr/dist/main/utils/base64url.js'
import { createChunks } from '@supabase/ssr/dist/main/utils/chunker.js'

const BASE = 'https://latch-lemon.vercel.app'
const PROJECT_REF = 'vbyfrvjssxrddsxwestg'
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`
const OUT = 'scripts/test-screens'

// Load env
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
const TEST_EMAIL = process.argv[2] ?? 'alexandreschwerkolt@gmail.com'

const checks = []
const log = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

await mkdir(OUT, { recursive: true })

// ─── 1. Mint OTP and verify → session ────────────────────────────────────
const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { persistSession: false },
})

const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: TEST_EMAIL,
})
if (linkErr) throw linkErr
const otp = linkData?.properties?.email_otp
log('OTP minted', !!otp)

const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, token: otp, type: 'magiclink' }),
})
if (!verifyResp.ok) {
  console.error('verify failed:', verifyResp.status, await verifyResp.text())
  process.exit(1)
}
const session = await verifyResp.json()
log('Session minted', !!session.access_token, `user=${session.user?.email}`)

// ─── 2. Build @supabase/ssr cookies ──────────────────────────────────────
// SSR storage format: cookie value = "base64-" + base64url(JSON.stringify(session))
// Chunked across name, name.0, name.1, ... if encodeURIComponent length > 3180
const storedValue = 'base64-' + stringToBase64URL(JSON.stringify(session))
const chunks = createChunks(COOKIE_NAME, storedValue)
log(`Built ${chunks.length} cookie chunk(s)`, chunks.length > 0)

// ─── 3. Open Playwright + inject cookies ────────────────────────────────
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
})

await context.addCookies(
  chunks.map((c) => ({
    name: c.name,
    value: c.value,
    domain: 'latch-lemon.vercel.app',
    path: '/',
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
  }))
)

const page = await context.newPage()
const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))

try {
  // ─── 4. Should land on / (idle home) ──────────────────────────────────
  const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 })
  log('GET / responds 200', resp?.status() === 200, `status=${resp?.status()}`)
  log(
    'No redirect to /login (auth cookie accepted)',
    page.url() === `${BASE}/`,
    page.url()
  )
  await page.screenshot({ path: `${OUT}/b1-idle.png`, fullPage: true })

  // ─── 5. Verify idle UI ────────────────────────────────────────────────
  const startBtn = page.locator('button', { hasText: 'Démarrer tétée' })
  log('Start button visible', await startBtn.isVisible())
  const sideText = await page.locator('text=Côté suggéré').textContent()
  log('Side suggestion shown', !!sideText, sideText?.trim())

  // ─── 6. Start a feeding ───────────────────────────────────────────────
  await startBtn.click()
  await page.waitForSelector('button:has-text("Stop")', { timeout: 5000 })
  log('Active timer screen reached', true)
  await page.screenshot({ path: `${OUT}/b2-active.png`, fullPage: true })

  await page.waitForTimeout(4000) // let chrono advance

  // ─── 7. Stop ──────────────────────────────────────────────────────────
  await page.click('button:has-text("Stop")')
  await page.waitForSelector('text=Tétée enregistrée', { timeout: 5000 })
  log('Done screen reached', true)
  await page.screenshot({ path: `${OUT}/b3-done.png`, fullPage: true })

  // ─── 8. Pick mood + note + Save ───────────────────────────────────────
  await page.click('button:has-text("😊")')
  await page.fill('textarea', 'browser e2e')
  await page.screenshot({ path: `${OUT}/b4-mood.png`, fullPage: true })
  await page.click('button:has-text("Sauvegarder")')

  await page.waitForSelector('button:has-text("Démarrer tétée")', { timeout: 5000 })
  log('Returned to idle after save', true)

  // ─── 9. Wait for sync, verify in DB via service_role ─────────────────
  await page.waitForTimeout(4000)

  const { data: feedings } = await admin
    .from('feedings')
    .select('*')
    .eq('user_id', session.user.id)
    .eq('note', 'browser e2e')
    .order('started_at', { ascending: false })
    .limit(1)

  const last = feedings?.[0]
  log('Feeding synced to Supabase', !!last)
  if (last) {
    log('mood_emoji = 😊', last.mood_emoji === '😊', last.mood_emoji)
    log('side is left or right', ['left', 'right'].includes(last.side), last.side)
    const dur = (new Date(last.ended_at).getTime() - new Date(last.started_at).getTime()) / 1000
    log('Duration ≥ 3s', dur >= 3, `${dur.toFixed(1)}s`)
  }

  log('No console errors', consoleErrors.length === 0, consoleErrors.join('; ') || 'clean')

  // ─── 10. Cleanup ─────────────────────────────────────────────────────
  if (last) {
    await admin.from('feedings').delete().eq('id', last.id)
  }
} catch (e) {
  log('Unexpected error', false, e instanceof Error ? e.message : String(e))
  await page.screenshot({ path: `${OUT}/b-error.png`, fullPage: true }).catch(() => {})
} finally {
  await browser.close()
}

const passed = checks.filter((c) => c.ok).length
console.log(`\n${passed}/${checks.length} passed`)
console.log(`screenshots: ${OUT}/b*.png`)
process.exit(passed === checks.length ? 0 : 1)
