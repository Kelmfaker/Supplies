import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const householdId = url.searchParams.get('householdId')
    if (!householdId) return NextResponse.json({ error: 'householdId required' }, { status: 400 })

    const supabase = await createServerClient()
    const { data, error } = await supabase.from('household_members').select('*').eq('household_id', householdId)
    if (error) {
      console.error('[v0] Error fetching household_members:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, members: data })
  } catch (err: any) {
    console.error('[v0] Unexpected error in debug-members route:', err)
    return NextResponse.json({ error: err.message || 'unexpected' }, { status: 500 })
  }
}
