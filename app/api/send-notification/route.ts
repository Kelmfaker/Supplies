import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { householdId } = body
    if (!householdId) {
      return NextResponse.json({ error: 'householdId is required' }, { status: 400 })
    }

    const supabase = await createServerClient()

    // Fetch supplies that are low or out
    const { data: suppliesData, error: suppliesError } = await supabase
      .from('supplies')
      .select('*')
      .eq('household_id', householdId)
      .in('status', ['low', 'out'])

    if (suppliesError) {
      console.error('[v0] Error fetching supplies for notifications:', suppliesError)
      return NextResponse.json({ error: suppliesError.message }, { status: 500 })
    }

    if (!suppliesData || suppliesData.length === 0) {
      return NextResponse.json({ ok: true, message: 'No items to notify' })
    }

    // Fetch categories to map names
    const { data: categoriesData } = await supabase.from('categories').select('*').eq('household_id', householdId)
    const categoriesMap: Record<string, string> = {}
    categoriesData?.forEach((c: any) => {
      categoriesMap[c.id] = c.name
    })

      // Remove stale notifications: any existing notification for this household
      // whose item_name is not in the current low/out supplies should be deleted.
      try {
        const currentNames = suppliesData.map((s: any) => s.name)
        const { data: allExisting, error: existingFetchErr } = await supabase
          .from('notifications')
          .select('id, item_name')
          .eq('household_id', householdId)

        if (existingFetchErr) {
          console.error('[v0] Error fetching existing notifications for cleanup:', existingFetchErr)
        } else if (allExisting && allExisting.length > 0) {
          const staleIds = (allExisting as any[])
            .filter((e) => !currentNames.includes(e.item_name))
            .map((e) => e.id)

          if (staleIds.length > 0) {
            const { error: delErr } = await supabase.from('notifications').delete().in('id', staleIds)
            if (delErr) console.error('[v0] Error deleting stale notifications:', delErr)
          }
        }
      } catch (err) {
        console.error('[v0] Exception during stale notification cleanup:', err)
      }

    // Build candidate notifications
    const candidateNotifications = suppliesData.map((s: any) => ({
      id: randomUUID(),
      item_name: s.name,
      category: categoriesMap[s.category] || 'Unknown',
      status: s.status,
      timestamp: new Date().toISOString(),
      is_read: false,
      household_id: householdId,
    }))

    // Prevent creating duplicate notifications for the same item/status if an unread
    // notification already exists. Fetch existing unread notifications for these items.
    try {
      const itemNames = suppliesData.map((s: any) => s.name)
      const { data: existing, error: existingErr } = await supabase
        .from('notifications')
        .select('item_name, status, is_read')
        .eq('household_id', householdId)
        .in('item_name', itemNames)
        .eq('is_read', false)

      if (existingErr) {
        console.error('[v0] Error checking existing notifications:', existingErr)
        return NextResponse.json({ error: existingErr.message }, { status: 500 })
      }

      const existingMap: Record<string, boolean> = {}
      ;(existing || []).forEach((e: any) => {
        existingMap[`${e.item_name}::${e.status}`] = true
      })

      const newNotifications = candidateNotifications.filter((n) => !existingMap[`${n.item_name}::${n.status}`])

      if (!newNotifications || newNotifications.length === 0) {
        return NextResponse.json({ ok: true, message: 'No items to notify' })
      }

      const { error: insertError } = await supabase.from('notifications').insert(newNotifications)
      if (insertError) {
        console.error('[v0] Error inserting notifications:', insertError)
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }

      // Replace suppliesData with only the items we actually inserted for downstream use
      // (e.g., SMS count)
      suppliesData.length = 0
      newNotifications.forEach((nn) => suppliesData.push({ name: nn.item_name, status: nn.status }))
    } catch (err) {
      console.error('[v0] Error preparing notifications:', err)
      return NextResponse.json({ error: (err as any).message || 'Error preparing notifications' }, { status: 500 })
    }

    // Optional: If Twilio credentials are provided, send SMS to husband's phone number stored in `household_members` table
    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
    const TWILIO_FROM = process.env.TWILIO_FROM

    const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM

    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && (TWILIO_FROM || TWILIO_WHATSAPP_FROM)) {
      try {
        const { data: members } = await supabase
          .from('household_members')
          .select('*')
          .eq('household_id', householdId)
          .eq('role', 'husband')

        const husband = members && members.length > 0 ? members[0] : null
        if (husband && husband.phone) {
          const smsBody = `Reminder: ${suppliesData.length} item(s) need restocking. Check the Household Supplies app.`

          // Lazy-import twilio so it's optional
          let twilioClient: any = null
          try {
            // @ts-ignore: optional dependency
            const TwilioImport: any = await import('twilio')
            const Twilio = TwilioImport.default || TwilioImport
            // Twilio SDK may be callable or constructible; handle both
            twilioClient = typeof Twilio === 'function' ? Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : new Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
          } catch (e) {
            console.warn('[v0] Twilio not installed or failed to import, skipping SMS/WhatsApp delivery')
          }

          if (twilioClient && suppliesData && suppliesData.length > 0) {
            try {
              if (TWILIO_WHATSAPP_FROM) {
                // Send via WhatsApp using Twilio (numbers must be in E.164 and WhatsApp-enabled)
                const from = TWILIO_WHATSAPP_FROM.startsWith('whatsapp:') ? TWILIO_WHATSAPP_FROM : `whatsapp:${TWILIO_WHATSAPP_FROM}`
                const to = husband.phone.startsWith('whatsapp:') ? husband.phone : `whatsapp:${husband.phone}`
                await twilioClient.messages.create({ body: smsBody, from, to })
              } else if (TWILIO_FROM) {
                // Fallback to plain SMS
                await twilioClient.messages.create({ body: smsBody, from: TWILIO_FROM, to: husband.phone })
              }
            } catch (err) {
              console.error('[v0] Twilio send failed:', err)
            }
          }
        }
      } catch (err) {
        console.error('[v0] Error sending SMS via Twilio:', err)
        // don't fail the whole request if SMS fails
      }
    }

    return NextResponse.json({ ok: true, message: 'Notifications created' })
  } catch (err: any) {
    console.error('[v0] Unexpected error in send-notification API:', err)
    return NextResponse.json({ error: err.message || 'Unexpected error' }, { status: 500 })
  }
}
