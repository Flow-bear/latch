import { readFileSync } from 'node:fs'

const ref = process.argv[2]
const pat = process.argv[3]
const filePath = process.argv[4] ?? 'supabase/schema.sql'

if (!ref || !pat) {
  console.error('usage: node scripts/apply-schema.mjs <project-ref> <pat> [sql-file]')
  console.error('  defaults sql-file to supabase/schema.sql')
  process.exit(1)
}

const sql = readFileSync(filePath, 'utf8')
console.log(`Applying ${filePath} (${sql.length} chars) to project ${ref}…`)

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
