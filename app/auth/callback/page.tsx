"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function AuthCallback() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    ;(async () => {
      let sessionFound = false
      try {
        // Log the full URL the browser received (helps debug access_token in hash)
        try {
          console.debug('[v0] callback URL:', typeof window !== 'undefined' ? window.location.href : '<no-window>')
        } catch (e) {
          /* ignore */
        }
        // Some Supabase client builds expose helper to parse session from URL
        // after a redirect (getSessionFromUrl). Call it if available.
        if (typeof (supabase.auth as any).getSessionFromUrl === 'function') {
          try {
            // storeSession: true will persist session in local storage/cookies
            await (supabase.auth as any).getSessionFromUrl({ storeSession: true })
          } catch (err) {
            // non-fatal — continue to polling
            console.debug('[v0] getSessionFromUrl threw, continuing to poll', err)
          }
        }

        // Poll for the authenticated user/session for up to ~5 seconds
        let attempts = 0
        while (attempts < 15) {
          try {
            const { data: userData } = await supabase.auth.getUser()
            if (userData?.user) {
              sessionFound = true
              break
            }

            const { data: sessionData } = await supabase.auth.getSession()
            if (sessionData?.session) {
              sessionFound = true
              break
            }
          } catch (err) {
            console.debug('[v0] polling auth state error:', err)
          }

          attempts += 1
          await new Promise((r) => setTimeout(r, 300))
        }
      } catch (err) {
        console.error('[v0] Error finishing sign-in from URL:', err)
      } finally {
        // If a session was found, proceed to the dashboard. Otherwise go back
        // to the homepage and show a hint so users can click the "I've confirmed" button.
        if (sessionFound) {
          router.replace('/dashboard')
        } else {
          // append query param so the homepage can show guidance if needed
          router.replace('/?signin=missing')
        }
      }
    })()
  }, [router, supabase])

  return <div className="min-h-screen flex items-center justify-center">Signing you in...</div>
}
