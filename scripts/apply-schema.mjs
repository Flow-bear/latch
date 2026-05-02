import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/schema.sql', 'utf8')
const ref = process.argv[2]
const pat = process.argv[3]

if (!ref || !pat) {
  console.error('usage: node scripts/apply-schema.mjs <project-ref> <pat>')
  process.exit(1)
}

const r = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  }
)
console.log(`HTTP ${r.status}`)
console.log(await r.text())
if (!r.ok) process.exit(1)
