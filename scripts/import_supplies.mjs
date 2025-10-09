import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

if (process.argv.length < 4) {
  console.log('Usage: node import_supplies.mjs <householdId> <path-to-json>')
  process.exit(1)
}

const householdId = process.argv[2]
const jsonPath = process.argv[3]

if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('Please set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL in environment')
  process.exit(2)
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-\u0600-\u06FF]+/g, '')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

async function main() {
  const raw = fs.readFileSync(jsonPath, 'utf8')
  const data = JSON.parse(raw)

  const categories = []
  const supplies = []

  data.forEach((group, gi) => {
    const name = group.category || `category-${gi}`
    const id = slugify(name) || `cat-${Math.random().toString(36).slice(2,9)}`
    categories.push({ id, name, icon: '📦', is_custom: true, household_id: householdId })

    const items = Array.isArray(group.items) ? group.items : []
    items.forEach((it, idx) => {
      const sid = `${id}-${idx}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
      supplies.push({ id: sid, name: it.name || `item-${idx}`, status: it.status || 'available', category: id, household_id: householdId, updated_at: new Date().toISOString() })
    })
  })

  console.log('Upserting', categories.length, 'categories and', supplies.length, 'supplies')

  if (categories.length > 0) {
    const { error: catErr } = await supabase.from('categories').upsert(categories, { onConflict: 'id' })
    if (catErr) {
      console.error('categories upsert error:', catErr)
      process.exit(3)
    }
  }

  if (supplies.length > 0) {
    const { error: supErr } = await supabase.from('supplies').upsert(supplies, { onConflict: 'id' })
    if (supErr) {
      console.error('supplies upsert error:', supErr)
      process.exit(4)
    }
  }

  console.log('Import complete')
}

main().catch((e) => {
  console.error(e)
  process.exit(10)
})
