"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Input } from "@/components/ui/input"
import { Plus, QrCode } from "lucide-react"

export function LoginForm() {
  const [role, setRole] = useState<"wife" | "husband">("wife")
  const [email, setEmail] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [hasAccount, setHasAccount] = useState(false)
  const router = useRouter()
  const supabase = createClient()
  const searchParams = useSearchParams()

  useEffect(() => {
    // If the callback couldn't find a session it redirects to /?signin=missing
    // and we show a clear instruction to the user.
    if (typeof window !== 'undefined') {
      const signin = searchParams.get?.('signin')
      if (signin === 'missing') {
        setMessage('No active session detected. After clicking the link in your email, click "I\'ve confirmed — Continue" to finish sign-in. Also ensure your Supabase Redirect URL includes /auth/callback and open the email link in the same browser.')
      }
    }
  }, [searchParams])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const v = localStorage.getItem('hasAccount')
        setHasAccount(!!v)
      } catch (e) {
        /* ignore */
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const remembered = localStorage.getItem('rememberedEmail')
        if (remembered) setEmail(remembered)
      } catch (e) {
        /* ignore */
      }
    }
  }, [])

  const handleLogin = async () => {
    // Use magic link sign-in via Supabase
    if (!email.trim()) {
      setMessage('Please enter your email to continue')
      return
    }

    try {
      // Provide an explicit redirect so the magic link returns to the running app
      // Redirect via a callback route so we can process the session from the URL
      const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}/auth/callback` : undefined
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      })
      if (error) throw error
      // store selected role temporarily; we'll set role permanently after join
      if (typeof window !== 'undefined') {
        localStorage.setItem("tempRole", role)
        try { localStorage.setItem('hasAccount', 'true') } catch (e) { }
      }
      setMessage('Check your email for the sign-in link. After signing in, open the app again.')
    } catch (err: any) {
      console.error('[v0] Error sending magic link:', err)
      setMessage('Failed to send sign-in link. See console for details.')
    }
  }

  // For users who already clicked the magic link: detect session and continue
  const handleContinueAfterConfirm = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !user.email) {
        setMessage('No active session found. Please check your email or resend the sign-in link.')
        return
      }

      // Keep magic-link sign-in only. Role is stored and the user navigates to dashboard
      if (typeof window !== 'undefined') {
        localStorage.setItem('tempRole', role)
        localStorage.setItem('userRole', role)
        try { localStorage.setItem('hasAccount', 'true') } catch (e) { }
      }
      router.replace('/dashboard')
    } catch (err) {
      console.error('[v0] Continue after confirm failed:', err)
      setMessage('Failed to continue after confirmation. See console for details.')
    }
  }

  return (
    <Card className="w-full max-w-md mx-4">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold text-emerald-700">Household Supplies Manager</CardTitle>
        <CardDescription>{hasAccount ? 'Login with your code' : 'Select your role to continue'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <RadioGroup value={role} onValueChange={(value) => setRole(value as "wife" | "husband")}>
          <div className="flex items-center space-x-3 p-4 border rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer">
            <RadioGroupItem value="wife" id="wife" />
            <Label htmlFor="wife" className="flex-1 cursor-pointer">
              <div className="font-semibold">Wife</div>
              <div className="text-sm text-muted-foreground">Manage and update supplies</div>
            </Label>
          </div>
          <div className="flex items-center space-x-3 p-4 border rounded-lg hover:bg-emerald-50 transition-colors cursor-pointer">
            <RadioGroupItem value="husband" id="husband" />
            <Label htmlFor="husband" className="flex-1 cursor-pointer">
              <div className="font-semibold">Husband</div>
              <div className="text-sm text-muted-foreground">View notifications and supplies</div>
            </Label>
          </div>
        </RadioGroup>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Choose an action to connect with your partner using a household code.</p>
          <Button
            onClick={() => {
              // Mark that we want to auto-generate a household code when we reach the dashboard
              if (typeof window !== 'undefined') {
                try { localStorage.setItem('autoGenerate', '1') } catch (e) { }
                localStorage.setItem('tempRole', role)
                localStorage.setItem('userRole', role)
              }
              router.replace('/dashboard')
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Generate Household Code
          </Button>

          <Button
            onClick={() => {
              if (typeof window !== 'undefined') {
                try { localStorage.setItem('autoJoin', '1') } catch (e) { }
                localStorage.setItem('tempRole', role)
                localStorage.setItem('userRole', role)
              }
              router.replace('/dashboard')
            }}
            variant="outline"
            className="w-full mt-2"
          >
            <QrCode className="h-4 w-4 mr-2" />
            Join by Household Code
          </Button>

          {message && <p className="text-sm text-muted-foreground">{message}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
