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

const MOCK_CHECKIN = {
  id: 'preview-checkin',
  message:
    "4 tétées hier soir, ~14 min côté droit en moyenne. Beau rythme. Pense à hydrater avant la tétée de nuit, c'est souvent la plus longue.",
  read_at: null,
}

/**
 * @param {string} label  filename suffix
 * @param {number} hour   forced hour (drives day/night mode via Date.getHours)
 * @param {{checkin?: 'open' | 'collapsed' | 'none'}} opts
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
      // open or collapsed: return the same payload; collapsed differs only via localStorage
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CHECKIN),
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

  const resp = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(1200)
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
  await shoot('day-checkin-open', 14, { checkin: 'open' })
  await shoot('day-checkin-collapsed', 14, { checkin: 'collapsed' })
  await shoot('day-no-checkin', 14, { checkin: 'none' })
  await shoot('night-checkin-open', 23, { checkin: 'open' })
  await shoot('night-checkin-collapsed', 23, { checkin: 'collapsed' })

  // Login page (logged out)
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
