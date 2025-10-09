import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { householdId, role, email, phone } = body
    if (!householdId || !role) {
      return NextResponse.json({ error: 'householdId and role are required' }, { status: 400 })
    }

    const supabase = await createClient()

    const token = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).substring(2, 10).toUpperCase()

    const record: any = {
      household_id: householdId,
      role,
      invite_token: token,
      invite_status: 'pending',
      created_at: new Date().toISOString(),
    }
    if (email) record.email = email.toLowerCase()
    if (phone) record.phone = phone

    const { data, error } = await supabase.from('household_members').insert([record]).select().limit(1)
    if (error) {
      console.error('[v0] invite insert error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ invite: data?.[0] || null })
  } catch (err: any) {
    console.error('[v0] invite route error:', err)
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 })
  }
}
