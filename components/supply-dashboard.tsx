"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { SupplyCategory } from "@/components/supply-category"
import { LogOut, Bell, Plus, X, QrCode, FileText, ImageIcon, Wifi, WifiOff, Download, Upload } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export type Supply = {
  id: string
  name: string
  // optional bilingual fields preserved when present in imports
  name_ar?: string
  name_en?: string
  status: "available" | "low" | "out"
  category: string
}

export type Category = {
  id: string
  name: string
  name_ar?: string
  name_en?: string
  icon: string
  isCustom: boolean
}

// Keep a minimal English fallback for UI; the app will initialize using
// the bundled Arabic dataset below (excluding certain categories).
const DEFAULT_CATEGORIES: Category[] = [
  { id: "spices", name: "Spices", icon: "🌶️", isCustom: false },
  { id: "cleaning", name: "Cleaning Tools", icon: "�", isCustom: false },
]

// Bundled default dataset (from the JSON you provided). We will use this
// to initialize a new household. Certain English categories (Dairy, Grains,
// Fruits, Vegetables) are intentionally excluded below when importing.
// Each item/category may now contain both Arabic and English names. We
// preserve backward-compatible `name` but store `name_ar` and `name_en`
// when present so both languages are available in the DB and UI.
type BundledItem = { name?: string; name_ar?: string; name_en?: string; status: string }
import DEFAULT_BUNDLED_JSON from "../data/default-bundled.json"
// Build grouped shape: for each category from the bundled JSON, collect its supplies
const rawBundled = DEFAULT_BUNDLED_JSON as any
const DEFAULT_BUNDLED_DATA: Array<{ category: string | { name_ar?: string; name_en?: string; name?: string }; items: BundledItem[] }> =
  (rawBundled.categories || []).map((c: any) => ({
    category: c.name,
    items: (rawBundled.supplies || []).filter((s: any) => s.category === c.id).map((s: any) => ({ name: s.name, name_ar: s.name_ar, name_en: s.name_en, status: s.status }))
  }))

export function SupplyDashboard() {
  const [userRole, setUserRole] = useState<"wife" | "husband" | null>(null)
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES)
  const [notifications, setNotifications] = useState<
    Array<{
      id: string
      itemName: string
      category: string
      status: string
      timestamp: string
      isRead: boolean
    }>
  >([])
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([])
  const [householdId, setHouseholdId] = useState<string | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  const [setupCode, setSetupCode] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [showAddCategory, setShowAddCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newCategoryIcon, setNewCategoryIcon] = useState("")
  const [notificationSent, setNotificationSent] = useState(false)
  const [showQRCode, setShowQRCode] = useState(false)
  const [qrCodeText, setQrCodeText] = useState("")
  const [showImportQR, setShowImportQR] = useState(false)
  const [importQRText, setImportQRText] = useState("")
  const [isImporting, setIsImporting] = useState(false)
  const [isExportingImage, setIsExportingImage] = useState(false)
  const [members, setMembers] = useState<Array<{ id: string; role: string; email?: string; phone?: string }>>([])
  const [inviteContact, setInviteContact] = useState<string>("")
  const [globalOpenState, setGlobalOpenState] = useState<boolean | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    // Initialize role/household state. Be resilient: don't immediately kick users
    // back to the login page if they're already authenticated via Supabase.
    const init = async () => {
      const storedRole = localStorage.getItem("userRole") as "wife" | "husband" | null
      const tempRole = localStorage.getItem("tempRole") as "wife" | "husband" | null

      // Check Supabase session once — we'll use this to decide whether to show
      // the setup flow or redirect to the login page.
      let isAuthed = false
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user?.email) isAuthed = true
      } catch (err) {
        console.warn('[v0] supabase.auth.getUser() failed:', err)
      }

      // If we have a stored role, use it.
      if (storedRole) {
        setUserRole(storedRole)
      } else if (tempRole) {
        // If a temporary role was set before sign-in (from the login form),
        // promote it to the persistent role so users aren't bounced.
        setUserRole(tempRole)
        localStorage.setItem('userRole', tempRole)
      }

      const savedHouseholdId = localStorage.getItem("householdId")
      if (savedHouseholdId) {
        setHouseholdId(savedHouseholdId)
        setIsConnected(true)
  await loadDataFromSupabase(savedHouseholdId)
  const cleanupRealtime = setupRealtimeSubscription(savedHouseholdId)
  const cleanupMembers = setupMembersSubscription(savedHouseholdId)
  // ensure both cleanups are available if needed later (not stored in this ref but will be removed on unmount via supabase.removeChannel)
        // load current household members so both partners see invites
        try {
          await loadMembers(savedHouseholdId)
        } catch (err) {
          console.warn('[v0] loadMembers failed on init:', err)
        }
        setShowSetup(false)
        return
      }

      // If the homepage set an autoGenerate/autoJoin flag, handle it here.
      try {
        const autoGen = localStorage.getItem('autoGenerate')
        const autoJoin = localStorage.getItem('autoJoin')
        if (autoGen) {
          localStorage.removeItem('autoGenerate')
          // generate a new code and connect
          handleGenerateCode()
          return
        }
        if (autoJoin) {
          localStorage.removeItem('autoJoin')
          // open the prompt to enter a code
          handleJoinHousehold()
          return
        }
      } catch (e) {
        /* ignore localStorage errors */
      }

      // No saved household — if authenticated, try auto-join by email.
      if (isAuthed) {
        setShowSetup(true)
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          const email = user?.email?.toLowerCase()
          if (email) {
            console.log('[v0] Checking for household invite for', email)
            const { data } = await supabase.from('household_members').select('household_id, role').eq('email', email).limit(1)
            if (data && data.length > 0) {
              const hid = data[0].household_id
              setHouseholdId(hid)
              localStorage.setItem('householdId', hid)
              setIsConnected(true)
              setShowSetup(false)

              // prefer tempRole (user-selected) but fall back to record role
              const chosenRole = (tempRole as 'wife' | 'husband') || (data[0].role as 'wife' | 'husband') || 'husband'
              setUserRole(chosenRole)
              localStorage.setItem('userRole', chosenRole)

              await loadDataFromSupabase(hid)
              setupRealtimeSubscription(hid)
              setupMembersSubscription(hid)
              try {
                await loadMembers(hid)
              } catch (err) {
                console.warn('[v0] loadMembers failed after auto-join:', err)
              }
              return
            }
          }
        } catch (err) {
          console.error('[v0] Auto-join by auth email failed:', err)
        }

        // If authenticated but no household invite, leave the setup UI visible so
        // the user can create or join a household without being redirected.
        return
      }

      // Not authenticated and no role: send user to the login page.
    setShowSetup(true)
      router.push("/")
    }

    init()
  }, [router])

  const loadDataFromSupabase = async (houseId: string) => {
    try {
      // Fetch categories and supplies in parallel. Only initialize bundled defaults
      // when BOTH categories and supplies are absent for this household. This avoids
      // creating/depleting items when a household already has data.
      const [catRes, supRes] = await Promise.all([
        supabase.from("categories").select("*").eq("household_id", houseId),
        supabase.from("supplies").select("*").eq("household_id", houseId),
      ])

      const categoriesData = catRes.data
      const suppliesData = supRes.data

      if (categoriesData && categoriesData.length > 0) {
        const loadedCategories = categoriesData.map((c: any) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
          isCustom: c.is_custom,
        }))
        setCategories(loadedCategories)
      }

      if ((!categoriesData || categoriesData.length === 0) && (!suppliesData || suppliesData.length === 0)) {
        // No data exists yet for this household — initialize defaults once.
        await initializeDefaultCategories(houseId)
        // After initialization, reload categories and supplies below by fetching again
        const { data: refreshedCategories } = await supabase.from('categories').select('*').eq('household_id', houseId)
        if (refreshedCategories && refreshedCategories.length > 0) {
          setCategories(refreshedCategories.map((c: any) => ({ id: c.id, name: c.name, icon: c.icon, isCustom: c.is_custom })))
        }
        const { data: refreshedSupplies } = await supabase.from('supplies').select('*').eq('household_id', houseId)
        if (refreshedSupplies) setSupplies(refreshedSupplies as Supply[])
      } else {
        if (suppliesData) setSupplies(suppliesData as Supply[])
      }

      const { data: notificationsData } = await supabase
        .from("notifications")
        .select("*")
        .eq("household_id", houseId)
        .order("timestamp", { ascending: false })

      if (notificationsData) {
        const formattedNotifications = notificationsData.map((n: any) => ({
          id: n.id,
          itemName: n.item_name,
          category: n.category,
          status: n.status,
          timestamp: n.timestamp,
          isRead: n.is_read,
        }))
        setNotifications(formattedNotifications)
      }
    } catch (error) {
      console.error("[v0] Error loading data:", error)
    }
  }

  const loadMembers = async (houseId: string) => {
    try {
      const { data } = await supabase.from('household_members').select('id, role, email, phone').eq('household_id', houseId)
      if (data) {
        setMembers(data as Array<{ id: string; role: string; email?: string; phone?: string }>)
      } else {
        setMembers([])
      }
    } catch (err) {
      console.error('[v0] Error loading members:', err)
      setMembers([])
    }
  }

  // realtime subscription for household members to refresh list on changes
  const setupMembersSubscription = (houseId: string) => {
    const channel = supabase
      .channel(`members-${houseId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'household_members', filter: `household_id=eq.${houseId}` },
        (payload) => {
          console.log('[v0] household_members change:', payload)
          // simple approach: reload members list on any change
          loadMembers(houseId).catch((err) => console.warn('[v0] reload members on change failed:', err))
        },
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  const initializeDefaultCategories = async (houseId: string) => {
    // Exclude these English categories if they appear in the bundled data
    const excludedEnglish = new Set(['Dairy', 'Grains', 'Fruits', 'Vegetables'])

    // Helper to slugify category names (preserve Arabic letters)
    const slugify = (text: string) =>
      text
        .toString()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-\u0600-\u06FF]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '')

    const categoriesToInsert: any[] = []
    const suppliesToInsert: any[] = []

    // Use the bundled data as the default set, but skip excluded English categories
    DEFAULT_BUNDLED_DATA.forEach((group) => {
      const rawCategoryName = typeof group.category === 'string' ? group.category : group.category.name || group.category.name_ar || group.category.name_en || ''
      const catId = slugify(rawCategoryName) || `cat-${Date.now().toString(36)}`
      // store bilingual fields when available; keep `name` for compatibility
      const categoryRow: any = {
        id: catId,
        name: rawCategoryName,
        icon: '📦',
        is_custom: true,
        household_id: houseId,
      }
      if (typeof group.category !== 'string') {
        if (group.category.name_ar) categoryRow.name_ar = group.category.name_ar
        if (group.category.name_en) categoryRow.name_en = group.category.name_en
      }
      categoriesToInsert.push(categoryRow)

      group.items.forEach((it, idx) => {
        // Create a deterministic id for bundled supplies so repeated imports/initialization
        // won't insert duplicates. Use a slug of the item name prefixed by category id.
        const rawItemName = it.name || it.name_en || it.name_ar || `item-${idx}`
        const itemSlug = slugify(rawItemName) || `item-${idx}`
        const sid = `${catId}-${itemSlug}`
        const supplyRow: any = {
          id: sid,
          name: rawItemName,
          status: it.status,
          category: catId,
          household_id: houseId,
          updated_at: new Date().toISOString(),
        }
        if (it.name_ar) supplyRow.name_ar = it.name_ar
        if (it.name_en) supplyRow.name_en = it.name_en
        suppliesToInsert.push(supplyRow)
      })
    })

    if (categoriesToInsert.length > 0) {
      await supabase.from('categories').upsert(categoriesToInsert, { onConflict: 'id' })
    }
    if (suppliesToInsert.length > 0) {
      await supabase.from('supplies').upsert(suppliesToInsert, { onConflict: 'id' })
    }
  }

  const setupRealtimeSubscription = (houseId: string) => {
    const suppliesChannel = supabase
      .channel(`supplies-${houseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "supplies",
          filter: `household_id=eq.${houseId}`,
        },
        (payload) => {
          console.log("[v0] Supplies change received:", payload)
          if (payload.eventType === "INSERT") {
            setSupplies((prev) => [...prev, payload.new as Supply])
          } else if (payload.eventType === "UPDATE") {
            setSupplies((prev) => prev.map((s) => (s.id === payload.new.id ? (payload.new as Supply) : s)))
          } else if (payload.eventType === "DELETE") {
            setSupplies((prev) => prev.filter((s) => s.id !== payload.old.id))
          }
        },
      )
      .subscribe()

    const categoriesChannel = supabase
      .channel(`categories-${houseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "categories",
          filter: `household_id=eq.${houseId}`,
        },
        (payload) => {
          console.log("[v0] Categories change received:", payload)
          if (payload.eventType === "INSERT") {
            const newCategory = {
              id: payload.new.id,
              name: payload.new.name,
              icon: payload.new.icon,
              isCustom: payload.new.is_custom,
            }
            setCategories((prev) => [...prev, newCategory])
          } else if (payload.eventType === "DELETE") {
            setCategories((prev) => prev.filter((c) => c.id !== payload.old.id))
          }
        },
      )
      .subscribe()

    const notificationsChannel = supabase
      .channel(`notifications-${houseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `household_id=eq.${houseId}`,
        },
        (payload) => {
          console.log("[v0] Notifications change received:", payload)
          if (payload.eventType === "INSERT") {
            const newNotification = {
              id: payload.new.id,
              itemName: payload.new.item_name,
              category: payload.new.category,
              status: payload.new.status,
              timestamp: payload.new.timestamp,
              isRead: payload.new.is_read,
            }
            setNotifications((prev) => [newNotification, ...prev])
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(suppliesChannel)
      supabase.removeChannel(categoriesChannel)
      supabase.removeChannel(notificationsChannel)
    }
  }


  const handleGenerateCode = () => {
    const code = typeof crypto !== 'undefined' && (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(36).substring(2, 10).toUpperCase()
    setSetupCode(code)
    setHouseholdId(code)
    localStorage.setItem("householdId", code)
    setIsConnected(true)
    setShowSetup(false)
    initializeDefaultCategories(code)
    setupRealtimeSubscription(code)
    setupMembersSubscription(code)
  }

  const handleJoinHousehold = () => {
    const code = prompt("Enter the household code:")
    if (!code) return

    const trimmed = code.trim()
    setHouseholdId(trimmed)
    localStorage.setItem("householdId", trimmed)
    setIsConnected(true)
    setShowSetup(false)
    loadDataFromSupabase(trimmed)
    setupRealtimeSubscription(trimmed)
    setupMembersSubscription(trimmed)
  }

  // Invite-by-email / join-by-email removed. Use household code generation and manual sharing instead.

  const handleLogout = () => {
    // Remember user's email so they don't have to re-type it next time.
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (user?.email) {
          localStorage.setItem('rememberedEmail', user.email.toLowerCase())
        }
      } catch (e) {
        // ignore
      }
    })()

    localStorage.removeItem("userRole")
    localStorage.removeItem("householdId")
    // Mark that this user has previously created an account so the homepage
    // shows login instead of signup language.
    try {
      localStorage.setItem('hasAccount', 'true')
    } catch (e) {
      /* ignore */
    }
    // Sign out from Supabase as well
    supabase.auth.signOut().catch((err) => console.error('[v0] Sign out error:', err))
    router.push("/")
  }

  // When a user has clicked the magic link and returned to the app, they can
  // press this button to let the client detect the session and auto-join by email.
  const handleCheckSession = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || !user.email) {
        // No active session; fall back to the normal login page
        router.push('/')
        return
      }

      const email = user.email.toLowerCase()
      console.log('[v0] handleCheckSession: found user', email)

      // If we already have a stored role, keep it; otherwise try tempRole
      const storedRole = localStorage.getItem('userRole') as 'wife' | 'husband' | null
      const tempRole = localStorage.getItem('tempRole') as 'wife' | 'husband' | null
      if (!storedRole && tempRole) {
        setUserRole(tempRole)
        localStorage.setItem('userRole', tempRole)
      }

      // Try to auto-join via household_members record
      const { data } = await supabase.from('household_members').select('household_id, role').eq('email', email).limit(1)
      if (data && data.length > 0) {
        const hid = data[0].household_id
        setHouseholdId(hid)
        localStorage.setItem('householdId', hid)
        setIsConnected(true)
        setShowSetup(false)

        const chosenRole = (localStorage.getItem('tempRole') as 'wife' | 'husband') || (data[0].role as 'wife' | 'husband') || 'husband'
        setUserRole(chosenRole)
        localStorage.setItem('userRole', chosenRole)

        await loadDataFromSupabase(hid)
          setupRealtimeSubscription(hid)
          try {
            await loadMembers(hid)
          } catch (err) {
            console.warn('[v0] loadMembers failed in handleCheckSession:', err)
          }
        return
      }

      // No invite found; show setup so the user can create or join manually
      setShowSetup(true)
    } catch (err) {
      console.error('[v0] handleCheckSession failed:', err)
      router.push('/')
    }
  }

  const handleStatusChange = async (supplyId: string, newStatus: "available" | "low" | "out") => {
    if (!householdId) return

    // Optimistic update: update local state immediately to avoid items jumping
    const prevSupplies = supplies
    setSupplies((prev) => prev.map((s) => (s.id === supplyId ? { ...s, status: newStatus } : s)))

    try {
      const { error } = await supabase
        .from("supplies")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", supplyId)
        .eq("household_id", householdId)
      if (error) {
        throw error
      }
      // success; don't reload the whole list to preserve order
    } catch (error) {
      console.error("[v0] Error updating supply:", error)
      // revert optimistic change
      setSupplies(prevSupplies)
      alert('Failed to update item status. See console for details.')
    }
  }

  const handleAddSupply = async (categoryId: string, name: string) => {
    if (!householdId) return

    const newSupply = {
      id: Date.now().toString(),
      name,
      status: "available" as const,
      category: categoryId,
      household_id: householdId,
    }

    try {
      await supabase.from("supplies").insert(newSupply)
      if (householdId) await loadDataFromSupabase(householdId)
    } catch (error) {
      console.error("[v0] Error adding supply:", error)
    }
  }

  const handleDeleteSupply = async (supplyId: string) => {
    if (!householdId) return

    if (!confirm('Delete this item? This cannot be undone.')) return

    try {
      await supabase.from("supplies").delete().eq("id", supplyId).eq("household_id", householdId)
      if (householdId) await loadDataFromSupabase(householdId)
    } catch (error) {
      console.error("[v0] Error deleting supply:", error)
    }
  }

  const handleAddCategory = async () => {
    if (!newCategoryName.trim() || !householdId) return

    const newCategory = {
      id: Date.now().toString(),
      name: newCategoryName.trim(),
      icon: newCategoryIcon.trim() || "📦",
      is_custom: true,
      household_id: householdId,
    }

    try {
      await supabase.from("categories").insert(newCategory)
      setNewCategoryName("")
      setNewCategoryIcon("")
      setShowAddCategory(false)
      if (householdId) await loadDataFromSupabase(householdId)
    } catch (error) {
      console.error("[v0] Error adding category:", error)
    }
  }

  const handleDeleteCategory = async (categoryId: string) => {
    if (!householdId) return

    if (!confirm('Delete this category and all its items? This cannot be undone.')) return

    try {
      await supabase.from("categories").delete().eq("id", categoryId).eq("household_id", householdId)
      await supabase.from("supplies").delete().eq("category", categoryId).eq("household_id", householdId)
      if (householdId) await loadDataFromSupabase(householdId)
    } catch (error) {
      console.error("[v0] Error deleting category:", error)
    }
  }

  const updateCategory = async (categoryId: string, updates: { name?: string; icon?: string }) => {
    return (async () => {
      if (!householdId) return
      try {
        await supabase.from('categories').update({ ...(updates.name !== undefined ? { name: updates.name } : {}), ...(updates.icon !== undefined ? { icon: updates.icon } : {}) }).eq('id', categoryId).eq('household_id', householdId)
        await loadDataFromSupabase(householdId)
      } catch (err) {
        console.error('[v0] Error updating category:', err)
        alert('Failed to update category. See console for details.')
      }
    })()
  }

  const updateSupply = async (supplyId: string, updates: { name?: string; status?: Supply['status'] }) => {
    if (!householdId) return
    try {
      await supabase.from('supplies').update({ ...(updates.name !== undefined ? { name: updates.name } : {}), ...(updates.status !== undefined ? { status: updates.status } : {}) }).eq('id', supplyId).eq('household_id', householdId)
      await loadDataFromSupabase(householdId)
    } catch (err) {
      console.error('[v0] Error updating supply:', err)
      alert('Failed to update item. See console for details.')
    }
  }

  const removeMember = async (memberId: string) => {
    if (!householdId) return
    try {
      if (!confirm('Remove this member/invite?')) return
      await supabase.from('household_members').delete().eq('id', memberId).eq('household_id', householdId)
      await loadMembers(householdId)
    } catch (err) {
      console.error('[v0] Error removing member:', err)
      alert('Failed to remove member. See console for details.')
    }
  }

  const leaveHousehold = async () => {
    if (!householdId) return
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const email = user?.email?.toLowerCase()
      if (!email) return alert('No authenticated email found')
      if (!confirm('Are you sure you want to leave this household?')) return
      await supabase.from('household_members').delete().eq('email', email).eq('household_id', householdId)
      // clear local state
      localStorage.removeItem('householdId')
      setHouseholdId(null)
      setIsConnected(false)
      setMembers([])
    } catch (err) {
      console.error('[v0] Error leaving household:', err)
      alert('Failed to leave household. See console for details.')
    }
  }

  type SendNotificationResult = { ok: boolean; message?: string; notificationsCreated?: number }
  const handleSendNotification = async (): Promise<SendNotificationResult> => {
    if (!householdId) {
      const msg = 'No household selected for sending notifications'
      alert(msg)
      return { ok: false, message: msg }
    }

    try {
      const res = await fetch("/api/send-notification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      })

      const text = await res.text()
      let json: any = null
      try {
        json = text ? JSON.parse(text) : null
      } catch (e) {
        // not JSON
      }

      if (!res.ok) {
        console.error('[v0] send-notification failed:', res.status, text)
        const msg = (json && (json.error || json.message)) || text || `Status ${res.status}`
        alert(`Failed to send reminders: ${msg}`)
        return { ok: false, message: msg }
      }

      if (json && json.message === 'No items to notify') {
        // Nothing to do but inform caller
        return { ok: true, message: 'No items to notify', notificationsCreated: 0 }
      }

      // Success path
      setNotificationSent(true)
      setTimeout(() => setNotificationSent(false), 3000)
      return { ok: true, message: (json && json.message) || 'Notifications created', notificationsCreated: json?.notifications_created || json?.insertedCount || 0 }
    } catch (error: any) {
      console.error("[v0] Error sending notifications via server:", error)
      const msg = error?.message || 'Check console for details.'
      alert(`Failed to send reminders: ${msg}`)
      return { ok: false, message: msg }
    }
  }

  const handleExportAsPDF = async () => {
    const neededItems = supplies.filter((s) => s.status === "low" || s.status === "out")

    if (neededItems.length === 0) {
      alert("No items need to be bought!")
      return
    }

    // Send reminders to household members (e.g., husband) when wife "checks out" by exporting
    try {
      await handleSendNotification()
    } catch (err) {
      console.error("[v0] Failed to send reminder before exporting PDF:", err)
    }

    const itemsByCategory: Record<string, Supply[]> = {}
    neededItems.forEach((item) => {
      if (!itemsByCategory[item.category]) {
        itemsByCategory[item.category] = []
      }
      itemsByCategory[item.category].push(item)
    })

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Shopping List</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
            h1 { color: #059669; border-bottom: 3px solid #059669; padding-bottom: 10px; }
            h2 { color: #0891b2; margin-top: 30px; }
            .item { padding: 10px; margin: 5px 0; background: #f0fdf4; border-left: 4px solid #10b981; }
            .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
            .status-low { background: #fef3c7; color: #92400e; }
            .status-out { background: #fee2e2; color: #991b1b; }
            .date { text-align: right; color: #6b7280; font-size: 14px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <h1>🛒 Shopping List</h1>
          ${Object.entries(itemsByCategory)
            .map(([categoryId, items]) => {
              const category = categories.find((c) => c.id === categoryId)
              return `
                <h2>${category?.icon || "📦"} ${category?.name || "Unknown"}</h2>
                ${items
                  .map(
                    (item) => `
                  <div class="item">
                    <strong>${item.name}</strong>
                    <span class="status status-${item.status}">${item.status === "low" ? "Low Stock" : "Out of Stock"}</span>
                  </div>
                `,
                  )
                  .join("")}
              `
            })
            .join("")}
          <div class="date">Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</div>
        </body>
      </html>
    `

    const blob = new Blob([htmlContent], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `shopping-list-${new Date().toISOString().split("T")[0]}.html`
    a.click()
    URL.revokeObjectURL(url)

    alert("Shopping list downloaded! Open the HTML file and print it as PDF from your browser.")
  }

  const handleExportAsImage = async () => {
    if (isExportingImage) return // Prevent multiple simultaneous exports
    
    try {
      setIsExportingImage(true)
      
      // Detect mobile WebView environment
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      const isWebView = /wv|WebView/i.test(navigator.userAgent) || 
                        (window.navigator as any).standalone === true || 
                        window.matchMedia('(display-mode: standalone)').matches
      const isMedianApp = window.location.href.includes('median.co') || 
                          navigator.userAgent.includes('Median') ||
                          (window as any).MedianNative !== undefined
      
      console.log('[v0] Environment detection:', { isMobile, isWebView, isMedianApp })
      
      const neededItems = supplies.filter((s) => s.status === "low" || s.status === "out")

      if (neededItems.length === 0) {
        alert("No items need to be bought!")
        return
      }

      // For mobile/WebView environments, try mobile-friendly export first
      if (isMobile || isWebView || isMedianApp) {
        console.log('[v0] Using mobile export method')
        
        // Special handling for Median.co apps
        if (isMedianApp) {
          console.log('[v0] Detected Median.co app environment')
          // Median.co apps have specific limitations, use the most compatible method
          try {
            await exportForMedianApp(neededItems)
            return
          } catch (medianErr) {
            console.log('[v0] Median-specific export failed, falling back to general mobile export:', medianErr)
          }
        }
        
        await exportForMobile(neededItems)
        return
      }

      // Check if browser supports required APIs
      if (typeof document === 'undefined') {
        alert("Export as image is not available in this environment")
        return
      }

      if (!document.createElement || !window.URL || !window.URL.createObjectURL) {
        alert("Your browser doesn't support image export. Please try a different browser.")
        return
      }

      const itemsByCategory: Record<string, Supply[]> = {}
      neededItems.forEach((item) => {
        if (!itemsByCategory[item.category]) {
          itemsByCategory[item.category] = []
        }
        itemsByCategory[item.category].push(item)
      })

      const canvas = document.createElement("canvas")
      const ctx = canvas.getContext("2d")
      
      if (!ctx) {
        alert("Canvas is not supported in your browser. Please try the PDF export instead.")
        return
      }

      // Check if toBlob is supported
      if (!canvas.toBlob) {
        alert("Image export is not supported in your browser. Please try the PDF export instead.")
        return
      }

      const padding = 40
      const lineHeight = 30
      const categoryHeight = 40
      const headerHeight = 80
      let totalHeight = headerHeight + padding * 2

      Object.values(itemsByCategory).forEach((items) => {
        totalHeight += categoryHeight + items.length * lineHeight + 20
      })

      canvas.width = 800
      canvas.height = totalHeight

      // Set up font fallbacks
      const fonts = {
        title: "bold 32px system-ui, -apple-system, Arial, sans-serif",
        subtitle: "14px system-ui, -apple-system, Arial, sans-serif", 
        category: "bold 24px system-ui, -apple-system, Arial, sans-serif",
        item: "16px system-ui, -apple-system, Arial, sans-serif",
        status: "bold 12px system-ui, -apple-system, Arial, sans-serif"
      }

      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.fillStyle = "#059669"
      ctx.font = fonts.title
      ctx.fillText("🛒 Shopping List", padding, padding + 32)

      ctx.fillStyle = "#6b7280"
      ctx.font = fonts.subtitle
      ctx.fillText(`${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, padding, padding + 60)

      let yPosition = headerHeight + padding

      Object.entries(itemsByCategory).forEach(([categoryId, items]) => {
        const category = categories.find((c) => c.id === categoryId)

        ctx.fillStyle = "#0891b2"
        ctx.font = fonts.category
        ctx.fillText(`${category?.icon || "📦"} ${category?.name || "Unknown"}`, padding, yPosition + 24)
        yPosition += categoryHeight

        items.forEach((item) => {
          ctx.fillStyle = "#f0fdf4"
          ctx.fillRect(padding, yPosition, canvas.width - padding * 2, lineHeight)

          ctx.fillStyle = "#10b981"
          ctx.fillRect(padding, yPosition, 4, lineHeight)

          ctx.fillStyle = "#000000"
          ctx.font = fonts.item
          ctx.fillText(item.name, padding + 15, yPosition + 20)

          const statusText = item.status === "low" ? "Low Stock" : "Out of Stock"
          const statusX = canvas.width - padding - 100
          ctx.fillStyle = item.status === "low" ? "#fef3c7" : "#fee2e2"
          ctx.fillRect(statusX, yPosition + 5, 90, 20)
          ctx.fillStyle = item.status === "low" ? "#92400e" : "#991b1b"
          ctx.font = fonts.status
          ctx.fillText(statusText, statusX + 5, yPosition + 18)

          yPosition += lineHeight
        })

        yPosition += 20
    })

    // Try to export the canvas as an image
    try {
      await new Promise<void>((resolve, reject) => {
        canvas.toBlob((blob) => {
          try {
            if (!blob) {
              reject(new Error("Failed to create image blob"))
              return
            }
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `shopping-list-${new Date().toISOString().split("T")[0]}.png`
            a.click()
            URL.revokeObjectURL(url)
            resolve()
          } catch (err) {
            reject(err)
          }
        }, 'image/png', 0.9)
      })
      
      console.log("[v0] Image exported successfully")
    } catch (err) {
      console.error("[v0] Failed to export image:", err)
      
      // Mobile-specific error handling
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
      
      if (isMobile) {
        alert("Image export failed on mobile. Trying alternative export method...")
        try {
          const neededItems = supplies.filter((s) => s.status === "low" || s.status === "out")
          await exportForMobile(neededItems)
          return
        } catch (mobileErr) {
          console.error("[v0] Mobile fallback also failed:", mobileErr)
          alert("All export methods failed. Please try copying the shopping list manually or use the PDF export.")
          return
        }
      }
      
      alert("Failed to export image. Your browser might not support this feature. Please try the PDF export instead.")
      
      // Offer fallback option
      const useFallback = confirm("Would you like to try an alternative export method? This will open a new tab with your shopping list.")
      if (useFallback) {
        try {
          const neededItems = supplies.filter((s) => s.status === "low" || s.status === "out")
          const itemsByCategory: Record<string, Supply[]> = {}
          neededItems.forEach((item) => {
            if (!itemsByCategory[item.category]) {
              itemsByCategory[item.category] = []
            }
            itemsByCategory[item.category].push(item)
          })
          await exportAsHTMLFallback(neededItems, itemsByCategory)
        } catch (fallbackErr) {
          console.error("[v0] Fallback export also failed:", fallbackErr)
          alert("All export methods failed. Please try the PDF export or copy the list manually.")
        }
      }
      return
    }

    // Send reminders to household members (e.g., husband) when wife "checks out" by exporting
    try {
      await handleSendNotification()
    } catch (err: any) {
      console.error("[v0] Failed to send reminder after exporting image:", err)
      alert(`Failed to send reminders: ${err?.message || 'See console'}`)
    }
    
    } catch (error: any) {
      console.error("[v0] Error in handleExportAsImage:", error)
      alert(`Failed to export image: ${error?.message || 'Unknown error'}. Please try the PDF export instead.`)
    } finally {
      setIsExportingImage(false)
    }
  }
  
  const exportAsHTMLFallback = async (neededItems: Supply[], itemsByCategory: Record<string, Supply[]>) => {
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Shopping List</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
              padding: 20px; 
              max-width: 800px; 
              margin: 0 auto; 
              background: #f9fafb;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            }
            h1 { 
              color: #059669; 
              border-bottom: 3px solid #059669; 
              padding-bottom: 10px; 
              margin-bottom: 20px;
            }
            h2 { 
              color: #0891b2; 
              margin-top: 30px; 
              border-left: 4px solid #0891b2;
              padding-left: 15px;
            }
            .item { 
              padding: 15px; 
              margin: 10px 0; 
              background: #f0fdf4; 
              border-left: 4px solid #10b981; 
              border-radius: 4px;
              display: flex;
              justify-content: space-between;
              align-items: center;
            }
            .status { 
              display: inline-block; 
              padding: 4px 12px; 
              border-radius: 16px; 
              font-size: 12px; 
              font-weight: bold; 
            }
            .status-low { 
              background: #fef3c7; 
              color: #92400e; 
            }
            .status-out { 
              background: #fee2e2; 
              color: #991b1b; 
            }
            .date { 
              text-align: right; 
              color: #6b7280; 
              font-size: 14px; 
              margin-top: 20px; 
            }
            .print-btn {
              background: #059669;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 4px;
              cursor: pointer;
              margin: 20px 0;
            }
            @media print {
              .print-btn { display: none; }
              body { background: white; }
              .container { box-shadow: none; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🛒 Shopping List</h1>
            <button class="print-btn" onclick="window.print()">Print This List</button>
            ${Object.entries(itemsByCategory)
              .map(([categoryId, items]) => {
                const category = categories.find((c) => c.id === categoryId)
                return `
                  <h2>${category?.icon || "📦"} ${category?.name || "Unknown"}</h2>
                  ${items
                    .map((item) => `
                      <div class="item">
                        <span>${item.name}</span>
                        <span class="status ${item.status === "low" ? "status-low" : "status-out"}">
                          ${item.status === "low" ? "Low Stock" : "Out of Stock"}
                        </span>
                      </div>
                    `).join("")}
                `
              }).join("")}
            <div class="date">
              Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
            </div>
          </div>
        </body>
      </html>
    `

    const blob = new Blob([htmlContent], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const newWindow = window.open(url, '_blank')
    
    if (!newWindow) {
      // If popup blocked, try download
      const a = document.createElement("a")
      a.href = url
      a.download = `shopping-list-${new Date().toISOString().split("T")[0]}.html`
      a.click()
    }
    
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  
  const exportForMobile = async (neededItems: Supply[]) => {
    const itemsByCategory: Record<string, Supply[]> = {}
    neededItems.forEach((item) => {
      if (!itemsByCategory[item.category]) {
        itemsByCategory[item.category] = []
      }
      itemsByCategory[item.category].push(item)
    })

    // Try Web Share API first (modern mobile browsers)
    if (navigator.share) {
      try {
        const text = generateShoppingListText(neededItems, itemsByCategory)
        await navigator.share({
          title: '🛒 Shopping List',
          text: text,
        })
        console.log('[v0] Successfully shared via Web Share API')
        return
      } catch (err) {
        console.log('[v0] Web Share API failed:', err)
        // Fall through to other methods
      }
    }

    // Try canvas with mobile-specific settings
    try {
      await exportCanvasForMobile(neededItems, itemsByCategory)
      return
    } catch (err) {
      console.log('[v0] Mobile canvas export failed:', err)
    }

    // Fallback to text-based share/copy
    try {
      const text = generateShoppingListText(neededItems, itemsByCategory)
      
      // Try clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        alert('Shopping list copied to clipboard! You can paste it anywhere.')
        return
      }
      
      // Final fallback - show text in alert/prompt
      const shouldCopy = confirm(`Canvas export not available on mobile. Would you like to copy the shopping list as text instead?\n\nPreview:\n${text.substring(0, 200)}...`)
      if (shouldCopy) {
        // Create temporary textarea for copy (older mobile browsers)
        const textarea = document.createElement('textarea')
        textarea.value = text
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
        alert('Shopping list copied to clipboard!')
      }
    } catch (err) {
      console.error('[v0] All mobile export methods failed:', err)
      alert('Unable to export on this device. Please use the PDF export or manually copy the items.')
    }
  }

  const generateShoppingListText = (neededItems: Supply[], itemsByCategory: Record<string, Supply[]>): string => {
    let text = '🛒 Shopping List\n'
    text += `Generated on ${new Date().toLocaleDateString()}\n\n`
    
    Object.entries(itemsByCategory).forEach(([categoryId, items]) => {
      const category = categories.find((c) => c.id === categoryId)
      text += `${category?.icon || "📦"} ${category?.name || "Unknown"}:\n`
      items.forEach((item) => {
        const status = item.status === "low" ? "Low Stock" : "Out of Stock"
        text += `• ${item.name} (${status})\n`
      })
      text += '\n'
    })
    
    return text
  }

  const exportCanvasForMobile = async (neededItems: Supply[], itemsByCategory: Record<string, Supply[]>): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")
        
        if (!ctx) {
          reject(new Error("Canvas not supported"))
          return
        }

        // Mobile-optimized canvas settings
        const scale = window.devicePixelRatio || 1
        const padding = 20 * scale
        const lineHeight = 40 * scale
        const categoryHeight = 50 * scale
        const headerHeight = 80 * scale
        
        let totalHeight = headerHeight + padding * 2
        Object.values(itemsByCategory).forEach((items) => {
          totalHeight += categoryHeight + items.length * lineHeight + 20 * scale
        })

        canvas.width = 400 * scale  // Smaller width for mobile
        canvas.height = totalHeight
        
        // Scale the context for high DPI displays
        ctx.scale(scale, scale)
        
        const width = canvas.width / scale
        const height = canvas.height / scale

        // Set up mobile-friendly fonts
        const fonts = {
          title: `bold ${24}px system-ui, -apple-system, Roboto, sans-serif`,
          subtitle: `${12}px system-ui, -apple-system, Roboto, sans-serif`, 
          category: `bold ${18}px system-ui, -apple-system, Roboto, sans-serif`,
          item: `${14}px system-ui, -apple-system, Roboto, sans-serif`,
          status: `bold ${10}px system-ui, -apple-system, Roboto, sans-serif`
        }

        // White background
        ctx.fillStyle = "#ffffff"
        ctx.fillRect(0, 0, width, height)

        // Title
        ctx.fillStyle = "#059669"
        ctx.font = fonts.title
        ctx.fillText("🛒 Shopping List", padding / scale, (padding + 24 * scale) / scale)

        // Date
        ctx.fillStyle = "#6b7280"
        ctx.font = fonts.subtitle
        ctx.fillText(`${new Date().toLocaleDateString()}`, padding / scale, (padding + 50 * scale) / scale)

        let yPosition = (headerHeight + padding) / scale

        Object.entries(itemsByCategory).forEach(([categoryId, items]) => {
          const category = categories.find((c) => c.id === categoryId)

          // Category header
          ctx.fillStyle = "#0891b2"
          ctx.font = fonts.category
          ctx.fillText(`${category?.icon || "📦"} ${category?.name || "Unknown"}`, padding / scale, yPosition + 18)
          yPosition += categoryHeight / scale

          items.forEach((item) => {
            // Item background
            ctx.fillStyle = "#f0fdf4"
            ctx.fillRect(padding / scale, yPosition, (width - padding * 2) / scale, lineHeight / scale)

            // Left border
            ctx.fillStyle = "#10b981"
            ctx.fillRect(padding / scale, yPosition, 4 / scale, lineHeight / scale)

            // Item name
            ctx.fillStyle = "#000000"
            ctx.font = fonts.item
            ctx.fillText(item.name, (padding + 15 * scale) / scale, yPosition + 20 / scale)

            // Status badge
            const statusText = item.status === "low" ? "Low" : "Out"
            const statusX = (width - padding - 60 * scale) / scale
            ctx.fillStyle = item.status === "low" ? "#fef3c7" : "#fee2e2"
            ctx.fillRect(statusX, yPosition + 5 / scale, 50 / scale, 15 / scale)
            ctx.fillStyle = item.status === "low" ? "#92400e" : "#991b1b"
            ctx.font = fonts.status
            ctx.fillText(statusText, statusX + 2 / scale, yPosition + 14 / scale)

            yPosition += lineHeight / scale
          })

          yPosition += 20 / scale
        })

        // Convert to blob with mobile-optimized settings
        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Failed to create image blob"))
            return
          }

          // For mobile, try different download methods
          try {
            const url = URL.createObjectURL(blob)
            
            // Try creating a download link
            const a = document.createElement("a")
            a.href = url
            a.download = `shopping-list-${new Date().toISOString().split("T")[0]}.png`
            
            // For mobile WebView, try different approaches
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            
            setTimeout(() => URL.revokeObjectURL(url), 1000)
            resolve()
          } catch (err) {
            reject(err)
          }
        }, 'image/png', 0.8) // Lower quality for smaller file size on mobile
        
      } catch (err) {
        reject(err)
      }
    })
  }
  
  const exportForMedianApp = async (neededItems: Supply[]): Promise<void> => {
    // Median.co apps have strict limitations on file downloads and canvas operations
    // Use the most reliable method: text-based sharing or clipboard
    
    const itemsByCategory: Record<string, Supply[]> = {}
    neededItems.forEach((item) => {
      if (!itemsByCategory[item.category]) {
        itemsByCategory[item.category] = []
      }
      itemsByCategory[item.category].push(item)
    })

    const text = generateShoppingListText(neededItems, itemsByCategory)
    
    // Try clipboard first (most reliable in WebView)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        alert('✅ Shopping list copied to clipboard!\n\nYou can now paste it in any messaging app, notes, or share it with others.')
        return
      }
    } catch (clipboardErr) {
      console.log('[v0] Clipboard API failed in Median app:', clipboardErr)
    }
    
    // Fallback: Try Web Share API (if available in Median)
    try {
      if (navigator.share) {
        await navigator.share({
          title: '🛒 Shopping List',
          text: text,
        })
        return
      }
    } catch (shareErr) {
      console.log('[v0] Web Share API failed in Median app:', shareErr)
    }
    
    // Final fallback: Manual copy with textarea (most compatible)
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      
      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)
      
      if (successful) {
        alert('✅ Shopping list copied to clipboard!\n\nYou can now paste it in any messaging app or notes.')
      } else {
        throw new Error('Copy command failed')
      }
    } catch (err) {
      console.error('[v0] All copy methods failed in Median app:', err)
      // Show the text in a prompt as last resort
      alert(`Unable to copy automatically. Here's your shopping list:\n\n${text}\n\nYou can manually copy this text.`)
    }
  }

  const handleExportData = () => {
    const exportData = {
      supplies,
      categories,
      notifications,
      uploadedFiles,
      householdId,
      exportDate: new Date().toISOString(),
    }

    const dataStr = JSON.stringify(exportData, null, 2)
    const blob = new Blob([dataStr], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `household-supplies-backup-${new Date().toISOString().split("T")[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportData = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".json"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      setIsImporting(true)
      console.log("[v0] Starting import process...")

      try {
        const text = await file.text()
        console.log("[v0] File read successfully, parsing JSON...")
        const importedData = JSON.parse(text)
        console.log("[v0] Imported data:", importedData)

        // Update local state first
        if (importedData.supplies) {
          console.log("[v0] Setting supplies:", importedData.supplies.length, "items")
          setSupplies(importedData.supplies)
        }
        if (importedData.categories) {
          console.log("[v0] Setting categories:", importedData.categories.length, "items")
          setCategories(importedData.categories)
        }
        if (importedData.notifications) {
          console.log("[v0] Setting notifications:", importedData.notifications.length, "items")
          setNotifications(importedData.notifications)
        }
        if (importedData.uploadedFiles) {
          console.log("[v0] Setting uploadedFiles:", importedData.uploadedFiles.length, "items")
          setUploadedFiles(importedData.uploadedFiles)
        }

        if (householdId && isConnected) {
          console.log("[v0] Connected to household:", householdId)
          console.log("[v0] Syncing imported data to Supabase...")
          // Ask the user whether they want to merge or replace the household data
          // Note: Notifications and uploaded files in the JSON will be preserved even when replacing
          const replace = confirm('Import mode: OK = Replace existing household categories and supplies with this file (destructive).\n\nNotifications and uploaded files in the import will be preserved.')

          // Sync categories
          if (importedData.categories && importedData.categories.length > 0) {
            console.log("[v0] Syncing", importedData.categories.length, "categories...")
            const categoriesToSync = importedData.categories.map((c: any) => ({
              id: c.id,
              name: c.name || c.name_en || c.name_ar || '',
              icon: c.icon,
              is_custom: c.isCustom,
              household_id: householdId,
              ...(c.name_ar ? { name_ar: c.name_ar } : {}),
              ...(c.name_en ? { name_en: c.name_en } : {}),
            }))
            console.log("[v0] Categories to sync:", categoriesToSync)

            const { data: catData, error: catError } = await supabase
              .from("categories")
              .upsert(categoriesToSync, { onConflict: "id" })

            if (catError) {
              console.error("[v0] Error syncing categories:", catError)
              throw new Error(`Categories sync failed: ${catError.message}`)
            }
            console.log("[v0] Categories synced successfully:", catData)
          }

          // Sync supplies
          if (importedData.supplies && importedData.supplies.length > 0) {
            console.log("[v0] Syncing", importedData.supplies.length, "supplies...")
            const suppliesToSync = importedData.supplies.map((s: any) => ({
              id: s.id,
              name: s.name || s.name_en || s.name_ar || '',
              status: s.status,
              category: s.category,
              household_id: householdId,
              updated_at: new Date().toISOString(),
              ...(s.name_ar ? { name_ar: s.name_ar } : {}),
              ...(s.name_en ? { name_en: s.name_en } : {}),
            }))
            console.log("[v0] Supplies to sync:", suppliesToSync)

            const { data: supData, error: supError } = await supabase
              .from("supplies")
              .upsert(suppliesToSync, { onConflict: "id" })

            if (supError) {
              console.error("[v0] Error syncing supplies:", supError)
              throw new Error(`Supplies sync failed: ${supError.message}`)
            }
            console.log("[v0] Supplies synced successfully:", supData)
          }

          if (replace) {
            // Delete any categories not present in the import
            try {
              const importedCategoryIds = (importedData.categories || []).map((c: any) => c.id)
              await supabase.from('categories').delete().not('id', 'in', `(${importedCategoryIds.map((id: any) => `'${id}'`).join(',')})`).eq('household_id', householdId)
            } catch (err) {
              console.warn('[v0] Failed to prune categories after replace import:', err)
            }

            // Delete any supplies not present in the import
            try {
              const importedSupplyIds = (importedData.supplies || []).map((s: any) => s.id)
              await supabase.from('supplies').delete().not('id', 'in', `(${importedSupplyIds.map((id: any) => `'${id}'`).join(',')})`).eq('household_id', householdId)
            } catch (err) {
              console.warn('[v0] Failed to prune supplies after replace import:', err)
            }
          }

          // Sync notifications
          if (importedData.notifications && importedData.notifications.length > 0) {
            console.log("[v0] Syncing", importedData.notifications.length, "notifications...")
            const notificationsToSync = importedData.notifications.map((n: any) => ({
              id: n.id,
              item_name: n.itemName || n.item_name || n.name || n.name_en || n.name_ar || '',
              category: n.category,
              status: n.status,
              timestamp: n.timestamp,
              is_read: n.isRead,
              household_id: householdId,
              ...(n.name_ar ? { item_name_ar: n.name_ar } : {}),
              ...(n.name_en ? { item_name_en: n.name_en } : {}),
            }))
            console.log("[v0] Notifications to sync:", notificationsToSync)

            const { data: notifData, error: notifError } = await supabase
              .from("notifications")
              .upsert(notificationsToSync, { onConflict: "id" })

            if (notifError) {
              console.error("[v0] Error syncing notifications:", notifError)
              throw new Error(`Notifications sync failed: ${notifError.message}`)
            }
            console.log("[v0] Notifications synced successfully:", notifData)
          }

          console.log("[v0] All data synced to Supabase successfully!")

          console.log("[v0] Reloading data from Supabase to verify sync...")
          await loadDataFromSupabase(householdId)
          console.log("[v0] Data reloaded successfully!")

          alert("✅ Data imported and synced to all devices successfully!")
        } else {
          console.log("[v0] Not connected to household, working in offline mode")
          alert("✅ Data imported successfully! (Offline mode - connect to sync with other devices)")
        }
      } catch (error) {
        console.error("[v0] Error during import:", error)
        alert(`❌ Failed to import data: ${error instanceof Error ? error.message : "Unknown error"}`)
      } finally {
        setIsImporting(false)
        console.log("[v0] Import process completed")
      }
    }
    input.click()
  }

  const handleImportQR = async () => {
    if (!importQRText.trim()) {
      alert("Please paste a code first")
      return
    }

    setIsImporting(true)
    console.log("[v0] Starting QR import process...")

    try {
      console.log("[v0] Decoding QR text...")
      const decoded = decodeURIComponent(atob(importQRText))
      console.log("[v0] Parsing decoded data...")
      const importedData = JSON.parse(decoded)
      console.log("[v0] Imported QR data:", importedData)

      // Update local state first
      if (importedData.supplies) {
        console.log("[v0] Setting supplies:", importedData.supplies.length, "items")
        setSupplies(importedData.supplies)
      }
      if (importedData.categories) {
        console.log("[v0] Setting categories:", importedData.categories.length, "items")
        setCategories(importedData.categories)
      }
      if (importedData.notifications) {
        console.log("[v0] Setting notifications:", importedData.notifications.length, "items")
        setNotifications(importedData.notifications)
      }
      if (importedData.uploadedFiles) {
        console.log("[v0] Setting uploadedFiles:", importedData.uploadedFiles.length, "items")
        setUploadedFiles(importedData.uploadedFiles)
      }

      if (householdId && isConnected) {
        console.log("[v0] Connected to household:", householdId)
        console.log("[v0] Syncing imported QR data to Supabase...")

  const replace = confirm('Import mode: OK = Replace existing household categories and supplies with this QR code (destructive).\n\nNotifications and uploaded files in the QR data will be preserved.')

        // Sync categories
        if (importedData.categories && importedData.categories.length > 0) {
          console.log("[v0] Syncing", importedData.categories.length, "categories...")
          const categoriesToSync = importedData.categories.map((c: any) => ({
            id: c.id,
            name: c.name || c.name_en || c.name_ar || '',
            icon: c.icon,
            is_custom: c.isCustom,
            household_id: householdId,
            ...(c.name_ar ? { name_ar: c.name_ar } : {}),
            ...(c.name_en ? { name_en: c.name_en } : {}),
          }))
          console.log("[v0] Categories to sync:", categoriesToSync)

          const { data: catData, error: catError } = await supabase
            .from("categories")
            .upsert(categoriesToSync, { onConflict: "id" })

          if (catError) {
            console.error("[v0] Error syncing categories:", catError)
            throw new Error(`Categories sync failed: ${catError.message}`)
          }
          console.log("[v0] Categories synced successfully:", catData)
        }

        // Sync supplies
        if (importedData.supplies && importedData.supplies.length > 0) {
          console.log("[v0] Syncing", importedData.supplies.length, "supplies...")
          const suppliesToSync = importedData.supplies.map((s: any) => ({
            id: s.id,
            name: s.name || s.name_en || s.name_ar || '',
            status: s.status,
            category: s.category,
            household_id: householdId,
            updated_at: new Date().toISOString(),
            ...(s.name_ar ? { name_ar: s.name_ar } : {}),
            ...(s.name_en ? { name_en: s.name_en } : {}),
          }))
          console.log("[v0] Supplies to sync:", suppliesToSync)

          const { data: supData, error: supError } = await supabase
            .from("supplies")
            .upsert(suppliesToSync, { onConflict: "id" })

          if (supError) {
            console.error("[v0] Error syncing supplies:", supError)
            throw new Error(`Supplies sync failed: ${supError.message}`)
          }
          console.log("[v0] Supplies synced successfully:", supData)
        }

        // Sync notifications
        if (importedData.notifications && importedData.notifications.length > 0) {
          console.log("[v0] Syncing", importedData.notifications.length, "notifications...")
          const notificationsToSync = importedData.notifications.map((n: any) => ({
              id: n.id,
              item_name: n.itemName || n.item_name || n.name || n.name_en || n.name_ar || '',
              category: n.category,
              status: n.status,
              timestamp: n.timestamp,
              is_read: n.isRead,
              household_id: householdId,
              ...(n.name_ar ? { item_name_ar: n.name_ar } : {}),
              ...(n.name_en ? { item_name_en: n.name_en } : {}),
            }))
          console.log("[v0] Notifications to sync:", notificationsToSync)

          const { data: notifData, error: notifError } = await supabase
            .from("notifications")
            .upsert(notificationsToSync, { onConflict: "id" })

          if (notifError) {
            console.error("[v0] Error syncing notifications:", notifError)
            throw new Error(`Notifications sync failed: ${notifError.message}`)
          }
          console.log("[v0] Notifications synced successfully:", notifData)
        }

        if (replace) {
          try {
            const importedCategoryIds = (importedData.categories || []).map((c: any) => c.id)
            await supabase.from('categories').delete().not('id', 'in', `(${importedCategoryIds.map((id: any) => `'${id}'`).join(',')})`).eq('household_id', householdId)
          } catch (err) {
            console.warn('[v0] Failed to prune categories after replace QR import:', err)
          }

          try {
            const importedSupplyIds = (importedData.supplies || []).map((s: any) => s.id)
            await supabase.from('supplies').delete().not('id', 'in', `(${importedSupplyIds.map((id: any) => `'${id}'`).join(',')})`).eq('household_id', householdId)
          } catch (err) {
            console.warn('[v0] Failed to prune supplies after replace QR import:', err)
          }
        }

        console.log("[v0] All QR data synced to Supabase successfully!")

        console.log("[v0] Reloading data from Supabase to verify sync...")
        await loadDataFromSupabase(householdId)
        console.log("[v0] Data reloaded successfully!")

        alert("✅ Data imported and synced to all devices successfully!")
      } else {
        console.log("[v0] Not connected to household, working in offline mode")
        alert("✅ Data imported successfully! (Offline mode - connect to sync with other devices)")
      }

      setShowImportQR(false)
      setImportQRText("")
    } catch (error) {
      console.error("[v0] Error importing QR code:", error)
      alert(`❌ Failed to import data: ${error instanceof Error ? error.message : "Invalid code format"}`)
    } finally {
      setIsImporting(false)
      console.log("[v0] QR import process completed")
    }
  }

  const handleGenerateQR = () => {
    try {
      const exportData = {
        supplies,
        categories,
        notifications,
        householdId,
      }

      const jsonStr = JSON.stringify(exportData)
      const encoded = btoa(encodeURIComponent(jsonStr))
      setQrCodeText(encoded)
      setShowQRCode(true)
    } catch (error) {
      console.error("[v0] Error generating QR code:", error)
      alert("Failed to generate QR code. Data might be too large.")
    }
  }

  const lowOrOutSupplies = supplies.filter((s) => s.status === "low" || s.status === "out")

  if (!userRole) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center">
        <p className="text-lg text-muted-foreground">Loading...</p>
      </div>
    )
  }

  if (showSetup || !householdId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-emerald-700">Setup Real-Time Sync</CardTitle>
            <CardDescription className="text-center mt-2">
              Connect your devices for automatic synchronization
            </CardDescription>
            <div className="space-y-4 mt-6">
              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Create New Household</h3>
                <p className="text-sm text-muted-foreground">Generate a code and share it with your partner</p>
                <Button onClick={handleGenerateCode} className="w-full bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Generate Household Code
                </Button>
                {setupCode && (
                  <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded">
                    <p className="text-sm font-medium text-emerald-700 mb-2">Your Household Code:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-2xl font-bold text-center bg-white p-3 rounded border">
                        {setupCode}
                      </code>
                      <Button
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(setupCode)
                          alert("Code copied!")
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Share this code with your partner to sync devices
                    </p>
                    <div className="mt-3">
                      <p className="text-sm font-medium text-emerald-700 mb-2">Share this code with your partner</p>
                      <p className="text-xs text-muted-foreground mt-2">Use the code above to connect devices in real-time.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">Or</span>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="font-semibold text-lg">Join Existing Household</h3>
                <p className="text-sm text-muted-foreground">Enter the code shared by your partner</p>
                <Button onClick={handleJoinHousehold} variant="outline" className="w-full bg-transparent">
                  <QrCode className="h-4 w-4 mr-2" />
                  Enter Household Code
                </Button>
                <div className="mt-2">
                  {/* Only code-based join is supported */}
                </div>
              </div>
            </div>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-emerald-700">Household Supplies</h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              Logged in as <Badge variant="secondary">{userRole}</Badge>
              {isConnected ? (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <Wifi className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              ) : (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {userRole === "husband" && (
              <Button variant="outline" onClick={() => router.push("/notifications")}>
                <Bell className="h-4 w-4 mr-2" />
                Notifications
                {lowOrOutSupplies.length > 0 && <Badge className="ml-2 bg-red-500">{lowOrOutSupplies.length}</Badge>}
              </Button>
            )}
            {!userRole ? (
              <Button variant="outline" onClick={handleCheckSession}>Login</Button>
            ) : (
              <Button variant="outline" onClick={handleLogout}>
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-700">Household Code</CardTitle>
            <CardDescription className="mt-2">
              Share this code with your partner to sync devices in real-time
            </CardDescription>
            <div className="flex items-center gap-3 mt-4">
              <code className="flex-1 text-xl font-bold bg-white p-3 rounded border text-center">{householdId}</code>
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(householdId || "")
                  alert("Code copied to clipboard!")
                }}
                variant="outline"
                className="bg-white"
              >
                Copy Code
              </Button>
             
            </div>
            {householdId && (
              <div className="mt-4 p-3 bg-white border border-blue-100 rounded">
                <p className="text-sm font-medium text-blue-700 mb-2">Share this household code</p>
                <p className="text-xs text-muted-foreground mt-2">Share the code above with your partner so they can join using the "Enter Household Code" option.</p>
                {/* Household members view removed to simplify the UI */}
                {/* Invite partner zone removed as requested */}
              </div>
            )}
          </CardHeader>
        </Card>

        <Card className="mb-6 border-purple-200 bg-purple-50">
          <CardHeader>
            <CardTitle className="text-purple-700">Backup & Manual Sync</CardTitle>
            <CardDescription className="mt-2">
              Export, import, or share data manually as a backup or alternative to real-time sync
            </CardDescription>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              {userRole === 'husband' ? (
                <Button onClick={handleExportAsImage} variant="outline" className="bg-white" disabled={isImporting || isExportingImage}>
                  <ImageIcon className="h-4 w-4 mr-2" />
                  {isExportingImage ? "Exporting..." : "Export as Image"}
                </Button>
              ) : (
                <>
                  <Button onClick={handleExportData} variant="outline" className="bg-white" disabled={isImporting}>
                    <Download className="h-4 w-4 mr-2" />
                    Export JSON
                  </Button>
                  <Button onClick={handleImportData} variant="outline" className="bg-white" disabled={isImporting}>
                    <Upload className="h-4 w-4 mr-2" />
                    {isImporting ? "Importing..." : "Import JSON"}
                  </Button>
                </>
              )}
              {/* QR generate/import intentionally hidden to simplify invite workflow */}
            </div>

            {showQRCode && (
              <div className="mt-4 p-4 bg-white border border-purple-200 rounded">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-purple-700">Share This Code</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowQRCode(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <textarea
                  readOnly
                  value={qrCodeText}
                  className="w-full h-32 p-2 border rounded text-xs font-mono"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(qrCodeText)
                    alert("Code copied to clipboard!")
                  }}
                  className="w-full mt-2 bg-purple-600 hover:bg-purple-700"
                >
                  Copy Code
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Share this code via messaging app, email, or any text method
                </p>
              </div>
            )}

            {showImportQR && (
              <div className="mt-4 p-4 bg-white border border-purple-200 rounded">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-purple-700">Paste Code to Import</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowImportQR(false)} disabled={isImporting}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <textarea
                  value={importQRText}
                  onChange={(e) => setImportQRText(e.target.value)}
                  placeholder="Paste the code here..."
                  className="w-full h-32 p-2 border rounded text-xs font-mono"
                  disabled={isImporting}
                />
                <Button
                  onClick={handleImportQR}
                  className="w-full mt-2 bg-purple-600 hover:bg-purple-700"
                  disabled={isImporting || !importQRText.trim()}
                >
                  {isImporting ? "Importing..." : "Import Data"}
                </Button>
              </div>
            )}
          </CardHeader>
        </Card>

        {userRole === "wife" && lowOrOutSupplies.length > 0 && (
          <Card className="mb-6 border-orange-200 bg-orange-50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-orange-700">Items Need Attention</CardTitle>
                  <CardDescription>{lowOrOutSupplies.length} item(s) are low or out of stock</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleExportAsImage} variant="outline" className="bg-white" disabled={isImporting || isExportingImage}>
                    <ImageIcon className="h-4 w-4 mr-2" />
                    {isExportingImage ? "Exporting..." : "Export as Image"}
                  </Button>
                  {/* Send via WhatsApp removed — use Export as Image/JSON or import flow instead */}
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {userRole === "wife" && (
          <div className="mb-6">
            {!showAddCategory ? (
              <Button onClick={() => setShowAddCategory(true)} variant="outline" className="w-full md:w-auto">
                <Plus className="h-4 w-4 mr-2" />
                Add New Category
              </Button>
            ) : (
              <Card className="border-emerald-200 bg-emerald-50">
                <CardHeader>
                  <div className="flex items-center justify-between mb-4">
                    <CardTitle className="text-emerald-700">Create New Category</CardTitle>
                    <Button variant="ghost" size="sm" onClick={() => setShowAddCategory(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Input
                      placeholder="Category name (e.g., Beverages)"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Icon (emoji, e.g., 🥤)"
                      value={newCategoryIcon}
                      onChange={(e) => setNewCategoryIcon(e.target.value)}
                      className="w-full sm:w-24"
                      maxLength={2}
                    />
                    <Button onClick={handleAddCategory} className="bg-emerald-600 hover:bg-emerald-700">
                      <Plus className="h-4 w-4 mr-2" />
                      Create
                    </Button>
                  </div>
                </CardHeader>
              </Card>
            )}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="col-span-full flex gap-2 mb-2">
            <Button onClick={() => setGlobalOpenState(false)} variant="outline">Collapse All</Button>
            <Button onClick={() => setGlobalOpenState(true)} variant="outline">Expand All</Button>
          </div>

          {categories.map((category) => (
            <SupplyCategory
              key={category.id}
              category={category}
              supplies={supplies.filter((s) => s.category === category.id)}
              onStatusChange={handleStatusChange}
              onAddSupply={handleAddSupply}
              onDeleteSupply={handleDeleteSupply}
              onDeleteCategory={category.isCustom ? handleDeleteCategory : undefined}
              onUpdateCategory={category.isCustom ? updateCategory : undefined}
              onUpdateSupply={updateSupply}
              isWife={userRole === "wife"}
              globalOpen={globalOpenState}
              onUserToggle={() => setGlobalOpenState(null)}
            />
          ))}
        </div>
      </main>
    </div>
  )
}
