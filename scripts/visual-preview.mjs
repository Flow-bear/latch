/**
 * Quick visual preview of the redesigned home, day + night.
 * Builds a local prod and serves it — does NOT touch deployed prod.
 *
 * Run: node scripts/visual-preview.mjs
 */

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
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

// Start local server
console.log('Starting next start on port', PORT)
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

async function shoot(label, hour) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
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
  await page.addInitScript((h) => {
    const real = Date.prototype.getHours
    // eslint-disable-next-line no-extend-native
    Date.prototype.getHours = function () {
      return h
    }
    return real
  }, hour)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 15000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/preview-${label}.png`, fullPage: true })
  console.log(`✓ ${label}`)
  await context.close()
}

try {
  await shoot('day-idle', 14)
  await shoot('night-idle', 23)

  // Login page (logged out)
  for (const [label, hour] of [['day-login', 14], ['night-login', 23]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
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
  server.kill()
}
console.log(`\nscreenshots in ${OUT}/preview-*.png`)
