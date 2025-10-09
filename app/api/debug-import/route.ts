import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

function slugify(text: string) {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-\u0600-\u06FF]+/g, '') // keep Arabic chars and word chars
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { householdId, data } = body
    if (!householdId) return NextResponse.json({ error: 'householdId is required' }, { status: 400 })
    if (!data || !Array.isArray(data)) return NextResponse.json({ error: 'data must be an array' }, { status: 400 })

    const supabase = await createServerClient()

    const categoriesToInsert: any[] = []
    const suppliesToInsert: any[] = []

    data.forEach((group: any) => {
      const categoryName = (group.category || 'Unknown').toString()
      const categoryId = slugify(categoryName) || `cat-${Math.random().toString(36).slice(2, 9)}`
      categoriesToInsert.push({ id: categoryId, name: categoryName, icon: '📦', is_custom: true, household_id: householdId })

      const items = Array.isArray(group.items) ? group.items : []
      items.forEach((it: any, idx: number) => {
        const supplyId = `${categoryId}-${idx}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
        suppliesToInsert.push({
          id: supplyId,
          name: it.name || `item-${idx}`,
          status: it.status || 'available',
          category: categoryId,
          household_id: householdId,
          updated_at: new Date().toISOString(),
        })
      })
    })

    // Upsert categories (avoid duplicates by id)
    if (categoriesToInsert.length > 0) {
      const { error: catErr } = await supabase.from('categories').upsert(categoriesToInsert, { onConflict: 'id' })
      if (catErr) {
        console.error('[debug-import] categories upsert error:', catErr)
        return NextResponse.json({ error: catErr.message }, { status: 500 })
      }
    }

    // Upsert supplies
    if (suppliesToInsert.length > 0) {
      const { error: supErr } = await supabase.from('supplies').upsert(suppliesToInsert, { onConflict: 'id' })
      if (supErr) {
        console.error('[debug-import] supplies upsert error:', supErr)
        return NextResponse.json({ error: supErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, inserted: { categories: categoriesToInsert.length, supplies: suppliesToInsert.length } })
  } catch (err: any) {
    console.error('[debug-import] Unexpected error:', err)
    return NextResponse.json({ error: err?.message || 'Unexpected error' }, { status: 500 })
  }
}
