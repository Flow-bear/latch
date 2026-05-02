/**
 * E2E test of the production login flow.
 * Run: node scripts/e2e-login.mjs [email]
 *
 * Steps verified:
 *   1. GET / → redirect to /login (middleware auth gate)
 *   2. /login renders correctly (title, form, button)
 *   3. Submit email → "Lien envoyé" confirmation
 *   4. Screenshots saved to scripts/test-screens/
 */

import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const BASE = 'https://latch-lemon.vercel.app'
const EMAIL = process.argv[2] ?? 'aschwerkolt@noelse.com'
const OUT = 'scripts/test-screens'

const checks = []
const log = (label, ok, detail) => {
  checks.push({ label, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`)
}

await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone-ish
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
})
const page = await context.newPage()

const consoleErrors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message))

try {
  // 1. Root redirect
  const resp = await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  log('GET / responds 200', resp?.status() === 200, `status=${resp?.status()}`)
  log(
    'Redirected to /login by middleware',
    page.url() === `${BASE}/login`,
    page.url()
  )
  await page.screenshot({ path: `${OUT}/1-login.png`, fullPage: true })

  // 2. Login page renders
  log(
    'Page title is "Latch"',
    (await page.title()) === 'Latch',
    await page.title()
  )
  const heading = await page.locator('h1').textContent()
  log('H1 says "Latch"', heading === 'Latch', heading ?? '(missing)')
  const placeholder = await page.locator('input[type=email]').getAttribute('placeholder')
  log('Email input present', !!placeholder, placeholder ?? '(missing)')
  const buttonText = await page.locator('button[type=submit]').textContent()
  log(
    'Submit button "Recevoir un lien"',
    buttonText?.trim() === 'Recevoir un lien',
    buttonText?.trim()
  )

  // 3. Submit email
  await page.fill('input[type=email]', EMAIL)
  await page.screenshot({ path: `${OUT}/2-filled.png`, fullPage: true })

  // Track the OTP request to Supabase
  const otpReq = page.waitForResponse(
    (r) => r.url().includes('/auth/v1/otp'),
    { timeout: 15_000 }
  )
  await page.click('button[type=submit]')

  let otpStatus
  try {
    const r = await otpReq
    otpStatus = r.status()
  } catch (e) {
    otpStatus = 'no request seen — ' + (e instanceof Error ? e.message : e)
  }
  log(
    'POST to Supabase /auth/v1/otp succeeds',
    otpStatus === 200,
    `status=${otpStatus}`
  )

  // Verify confirmation banner
  await page.waitForSelector('text=Lien envoyé', { timeout: 5_000 }).catch(() => null)
  const confirmation = await page.locator('text=Lien envoyé').first().textContent().catch(() => null)
  log(
    '"Lien envoyé" confirmation appears',
    !!confirmation,
    confirmation ?? '(missing)'
  )
  await page.screenshot({ path: `${OUT}/3-sent.png`, fullPage: true })

  // 4. Misc checks
  log('No console errors during flow', consoleErrors.length === 0, consoleErrors.join('; ') || 'clean')
} catch (e) {
  log('Unexpected error', false, e instanceof Error ? e.message : String(e))
} finally {
  await browser.close()
}

console.log('\n— summary —')
const passed = checks.filter((c) => c.ok).length
console.log(`${passed}/${checks.length} passed`)
console.log(`screenshots: ${OUT}/`)
process.exit(passed === checks.length ? 0 : 1)
