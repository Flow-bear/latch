/**
 * Visual preview of the home screen, mobile viewport, day + night.
 * Builds a local prod (next start on port 4101) — does NOT touch deployed prod.
 *
 * Auth: mints an OTP via Supabase admin → injects @supabase/ssr cookies into Playwright,
 * so the middleware sees a real session.
 *
 * Check-in state is mocked via page.route() so screenshots are deterministic
 * regardless of what's in the DB for today.
 *
 * Run:
 *   npm run build && node scripts/visual-preview.mjs
 *
 * Output: scripts/test-screens/preview-*.png
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { spawn, execSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdir, readFile } from 'node:fs/promises'
import { stringToBase64URL } from '@supabase/ssr/dist/main/utils/base64url.js'
import { createChunks } from '@supabase/ssr/dist/main/utils/chunker.js'

const PORT = 4101
const BASE = `http://localhost:${PORT}`
const PROJECT_REF = 'vbyfrvjssxrddsxwestg'
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`
const OUT = 'scripts/test-screens'
const TEST_EMAIL = 'alexandreschwerkolt@gmail.com'

await mkdir(OUT, { recursive: true })

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

// Mint session
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const { data: linkData } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: TEST_EMAIL,
})
const verifyResp = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: TEST_EMAIL, token: linkData.properties.email_otp, type: 'magiclink' }),
})
const session = await verifyResp.json()
const storedValue = 'base64-' + stringToBase64URL(JSON.stringify(session))
const chunks = createChunks(COOKIE_NAME, storedValue)

// Refuse to start if port is busy — otherwise we silently screenshot a stale server.
await new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', (err) => {
    reject(
      new Error(
        `Port ${PORT} is already in use (likely a stale 'next start' from a previous run): ${err.message}. ` +
          `Free it with: Get-NetTCPConnection -LocalPort ${PORT} | Select OwningProcess; Stop-Process -Id <pid>`
      )
    )
  })
  probe.once('listening', () => probe.close(resolve))
  probe.listen(PORT, '127.0.0.1')
})

// Start local server
console.log('Starting next start on port', PORT)
const isWin = process.platform === 'win32'
const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})
await new Promise((resolve) => {
  server.stdout.on('data', (d) => {
    if (d.toString().includes('Ready') || d.toString().includes('Local:')) {
      resolve()
    }
  })
  setTimeout(resolve, 8000)
})

const browser = await chromium.launch({ headless: true })

const MOCK_CHECKIN_SHORT = {
  id: 'preview-checkin',
  message:
    '4 tétées hier soir, ~14 min côté droit en moyenne. Très proche de tes nuits de la semaine. Bon début de journée.',
  read_at: null,
}

const MOCK_CHECKIN_LONG = {
  id: 'preview-checkin',
  // Mimics the verbose response that broke the layout pre-fix — used to
  // verify the card cap (max-h) + bottom-aligned CTA hold up.
  message:
    "Deux tétées côté droit en soirée et nuit, durée non renseignée. C'est cohérent avec ta moyenne de 2 tétées par jour, toujours le sein droit ces derniers jours. Si tu souhaites équilibrer les deux côtés ou si le gauche devient inconfortable, tu peux proposer ce sein en premier à la prochaine tétée. Sinon, continue comme ça, le rythme reste dans tes habitudes des sept derniers jours.",
  read_at: null,
}

// ─── Helpers to drive onboarding state via service_role ─────────────────
const TEST_USER_ID = session.user.id

const ONBOARDED_FIXTURE = {
  baby_name: 'Lou',
  baby_birth_date: '2026-02-15',
  is_first_child: true,
  feeding_type: 'exclusive',
  breastfeeding_start_date: '2026-02-15',
  current_rhythm: 'regular',
  has_professional_support: false,
  general_feeling: null,
  current_concern: null,
}

async function setOnboarded(onboarded) {
  if (onboarded) {
    await admin
      .from('profiles')
      .update({ ...ONBOARDED_FIXTURE, onboarded_at: new Date().toISOString() })
      .eq('id', TEST_USER_ID)
  } else {
    await admin
      .from('profiles')
      .update({
        onboarded_at: null,
        is_first_child: null,
        feeding_type: null,
        breastfeeding_start_date: null,
        current_rhythm: null,
        has_professional_support: false,
        general_feeling: null,
        current_concern: null,
      })
      .eq('id', TEST_USER_ID)
  }
}

async function setOnboardingProgress(currentStep, partialData) {
  await admin
    .from('user_onboarding_progress')
    .upsert(
      {
        user_id: TEST_USER_ID,
        current_step: currentStep,
        partial_data: partialData ?? {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    )
}

async function clearOnboardingProgress() {
  await admin
    .from('user_onboarding_progress')
    .delete()
    .eq('user_id', TEST_USER_ID)
}

// ─── Feedings seeding for /historique shoots ─────────────────────────────
// Use a recognizable note prefix so we can clean up after.
const SEED_NOTE_PREFIX = '__preview__'

// Offset in minutes back from `now`. Always strictly in the past so the modal
// validation ("L'heure de début ne peut pas être dans le futur") never fires
// in screenshots, regardless of when the script runs.
function makeSeed(minutesAgo, durationMin, side, mood = null, note = '') {
  const start = new Date(Date.now() - minutesAgo * 60_000)
  const end = new Date(start.getTime() + durationMin * 60_000)
  return {
    user_id: TEST_USER_ID,
    client_id: crypto.randomUUID(),
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    side,
    mood_emoji: mood,
    note: `${SEED_NOTE_PREFIX} ${note}`.trim(),
  }
}

async function seedFeedings() {
  await clearSeededFeedings()
  const M = 60 // minutes per hour
  const D = 24 * M // minutes per day
  const rows = [
    // today (relative — strictly in the past)
    makeSeed(2 * M, 14, 'right', '😊'),
    makeSeed(5 * M, 11, 'left'),
    makeSeed(9 * M, 17, 'right', '😐'),
    // yesterday
    makeSeed(D + 2 * M, 14, 'right'),
    makeSeed(D + 6 * M, 16, 'left'),
    makeSeed(D + 11 * M, 9, 'both', '😣', 'douleur sein gauche'),
    makeSeed(D + 15 * M, 12, 'right'),
    makeSeed(D + 18 * M, 13, 'left'),
    // 2 days ago
    makeSeed(2 * D + 4 * M, 15, 'right'),
    makeSeed(2 * D + 12 * M, 13, 'left'),
    makeSeed(2 * D + 16 * M, 11, 'right'),
  ]
  await admin.from('feedings').insert(rows)
}

async function clearSeededFeedings() {
  await admin
    .from('feedings')
    .delete()
    .eq('user_id', TEST_USER_ID)
    .like('note', `${SEED_NOTE_PREFIX}%`)
}

/**
 * @param {string} label  filename suffix
 * @param {number} hour   forced hour (drives day/night mode via Date.getHours)
 * @param {{
 *   checkin?: 'open' | 'collapsed' | 'none' | 'long',
 *   path?: string,
 *   after?: (page: import('playwright').Page) => Promise<void>,
 * }} opts
 */
async function shoot(label, hour, opts = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    // next-pwa registers a service worker that caches built chunks.
    // Across rebuilds, those chunk hashes no longer exist on disk → 400s →
    // page fails to hydrate. Block SWs entirely for screenshot runs.
    serviceWorkers: 'block',
  })
  await context.addCookies(
    chunks.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    }))
  )
  const page = await context.newPage()

  // Force hour for day/night palette
  await page.addInitScript((h) => {
    Date.prototype.getHours = function () {
      return h
    }
  }, hour)

  // Pre-set localStorage for the collapsed state (key matches app/page.tsx)
  if (opts.checkin === 'collapsed') {
    await page.addInitScript(() => {
      const today = new Date().toISOString().slice(0, 10)
      localStorage.setItem(`latch:checkin-collapsed:${today}`, '1')
    })
  }

  // Mock the morning_checkins endpoint for deterministic UI state
  if (opts.checkin) {
    await page.route('**/rest/v1/morning_checkins**', async (route) => {
      const method = route.request().method()
      if (method !== 'GET') {
        await route.fulfill({ status: 204, body: '' })
        return
      }
      if (opts.checkin === 'none') {
        // .maybeSingle() with 0 rows → PostgREST returns 406
        await route.fulfill({
          status: 406,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'PGRST116', message: 'No rows' }),
        })
        return
      }
      // open / collapsed / long: return a checkin payload. Collapsed differs
      // from open only via localStorage; long is the verbose-message variant
      // used to stress-test the card height cap.
      const payload =
        opts.checkin === 'long' ? MOCK_CHECKIN_LONG : MOCK_CHECKIN_SHORT
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      })
    })
  }

  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) =>
    errors.push(`[reqfail] ${r.url()} → ${r.failure()?.errorText}`)
  )

  const target = `${BASE}${opts.path ?? '/'}`
  const resp = await page.goto(target, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(1200)
  if (opts.after) {
    try {
      await opts.after(page)
    } catch (e) {
      console.log(`  after() failed for ${label}: ${e.message}`)
    }
  }
  const finalUrl = page.url()
  const bodyText = (await page.locator('body').textContent())?.slice(0, 120) ?? ''
  await page.screenshot({ path: `${OUT}/preview-${label}.png`, fullPage: true })
  console.log(
    `✓ ${label} — HTTP ${resp?.status()} → ${finalUrl} | body[0..120]="${bodyText.replace(/\s+/g, ' ').trim()}"`
  )
  if (errors.length) console.log(`  errors: ${errors.join(' | ')}`)
  await context.close()
}

try {
  // ─── Onboarding shoots: clear onboarded_at first ───────────────────────
  console.log('→ setting test user as NOT onboarded')
  await setOnboarded(false)

  // Step 1 (clean state)
  await clearOnboardingProgress()
  await shoot('day-onboarding-step1', 14, { path: '/onboarding' })
  await shoot('night-onboarding-step1', 23, { path: '/onboarding' })

  // Step 5 (mid-progress with several fields filled)
  await setOnboardingProgress(5, {
    baby_birth_date: '2026-02-15',
    is_first_child: true,
    feeding_type: 'exclusive',
    breastfeeding_start_date: '2026-02-15',
  })
  await shoot('day-onboarding-step5', 14, { path: '/onboarding' })

  // Step 7 (final, with concerns/feelings filled)
  await setOnboardingProgress(7, {
    baby_birth_date: '2026-02-15',
    is_first_child: true,
    feeding_type: 'exclusive',
    breastfeeding_start_date: '2026-02-15',
    current_rhythm: 'regular',
    has_professional_support: false,
    current_concern:
      "Quelques douleurs au sein gauche depuis 2 jours, sans crevasse visible.",
    general_feeling: "Fatiguée mais ça va, l'allaitement se met en place.",
    baby_name: 'Lou',
  })
  await shoot('day-onboarding-step7', 14, { path: '/onboarding' })

  // ─── Onboarded shoots: set the fixture profile ─────────────────────────
  console.log('→ setting test user as ONBOARDED')
  await clearOnboardingProgress()
  await setOnboarded(true)

  // Home (existing checkin variants)
  await shoot('day-checkin-open', 14, { checkin: 'open' })
  await shoot('day-checkin-open-long', 14, { checkin: 'long' })
  await shoot('day-checkin-collapsed', 14, { checkin: 'collapsed' })
  await shoot('day-no-checkin', 14, { checkin: 'none' })
  await shoot('night-checkin-open', 23, { checkin: 'open' })
  await shoot('night-checkin-open-long', 23, { checkin: 'long' })
  await shoot('night-checkin-collapsed', 23, { checkin: 'collapsed' })

  // Settings
  await shoot('day-settings', 14, { path: '/settings' })
  await shoot('night-settings', 23, { path: '/settings' })

  // ─── Historique (seed feedings, screenshot list + modals, cleanup) ─────
  console.log('→ seeding feedings for /historique')
  await seedFeedings()

  await shoot('day-historique-list', 14, { path: '/historique' })
  await shoot('night-historique-list', 23, { path: '/historique' })

  // Modal: edit (click first feeding row)
  await shoot('day-historique-modal-edit', 14, {
    path: '/historique',
    after: async (page) => {
      await page.locator('button[aria-label="Ajouter une tétée"]').waitFor({ timeout: 3000 })
      const firstRow = page.locator('section button').first()
      await firstRow.click()
      await page.waitForTimeout(400)
    },
  })

  // Modal: add (click FAB)
  await shoot('day-historique-modal-add', 14, {
    path: '/historique',
    after: async (page) => {
      await page.locator('button[aria-label="Ajouter une tétée"]').click()
      await page.waitForTimeout(400)
    },
  })

  // Note: skipping the "empty state" shot because the real test user has
  // genuine feedings the script must not delete. Empty-state UI is trivial
  // (a single centered line) and visually verifiable on the device.
  // Seeded feedings stay in the DB so the Vercel branch preview shows data.

  // Login page (logged out — no cookies)
  for (const [label, hour] of [['day-login', 14], ['night-login', 23]]) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
    })
    const p = await ctx.newPage()
    await p.addInitScript((h) => {
      Date.prototype.getHours = function () { return h }
    }, hour)
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${OUT}/preview-${label}.png`, fullPage: true })
    console.log(`✓ ${label}`)
    await ctx.close()
  }
} finally {
  await browser.close()
  // Windows: server.kill() only kills the npx wrapper; the actual `next start`
  // node process survives and holds the port across runs (silently serves stale
  // builds on the next invocation). Force-kill the whole tree.
  if (isWin) {
    try {
      execSync(`taskkill /F /T /PID ${server.pid}`, { stdio: 'ignore' })
    } catch {
      /* already dead */
    }
  } else {
    server.kill()
  }
}
console.log(`\nscreenshots in ${OUT}/preview-*.png`)
