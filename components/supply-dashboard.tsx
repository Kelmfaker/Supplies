"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { SupplyCategory } from "@/components/supply-category"
import { LogOut, Bell, Plus, X, QrCode, FileText, ImageIcon, Wifi, WifiOff, Download, Upload, Copy } from "lucide-react"
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
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
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
        // Real-time subscriptions will be handled by the dedicated useEffect
        
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
              // Real-time subscriptions will be handled by the dedicated useEffect
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

  // Real-time subscription management - handles setup and cleanup when household changes
  useEffect(() => {
    if (!householdId) {
      console.log("[v0] No household ID, skipping real-time setup")
      return
    }

    console.log("[v0] Setting up real-time subscriptions for household:", householdId)
    
    // Setup subscriptions
    const cleanupRealtime = setupRealtimeSubscription(householdId)
    const cleanupMembers = setupMembersSubscription(householdId)

    // Force reload data to ensure we have latest state when subscriptions start
    loadDataFromSupabase(householdId)

    // Cleanup function - called when householdId changes or component unmounts
    return () => {
      console.log("[v0] Cleaning up real-time subscriptions for household:", householdId)
      if (cleanupRealtime) cleanupRealtime()
      if (cleanupMembers) cleanupMembers()
    }
  }, [householdId]) // Re-run when householdId changes

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
          console.log("[v0] Current supplies count before update:", supplies.length)
          try {
            if (payload.eventType === "INSERT") {
              console.log("[v0] Adding new supply:", payload.new)
              setSupplies((prev) => {
                const newSupplies = [...prev, payload.new as Supply]
                console.log("[v0] Supplies after INSERT:", newSupplies.length)
                return newSupplies
              })
            } else if (payload.eventType === "UPDATE") {
              console.log("[v0] Updating supply:", payload.new.id, payload.new)
              setSupplies((prev) => {
                const updated = prev.map((s) => (s.id === payload.new.id ? (payload.new as Supply) : s))
                console.log("[v0] Supplies after UPDATE:", updated.length)
                return updated
              })
            } else if (payload.eventType === "DELETE") {
              console.log("[v0] Deleting supply:", payload.old.id)
              setSupplies((prev) => {
                const filtered = prev.filter((s) => s.id !== payload.old.id)
                console.log("[v0] Supplies after DELETE:", filtered.length)
                return filtered
              })
            }
          } catch (err) {
            console.error("[v0] Error handling supplies realtime update:", err)
          }
        },
      )
      .subscribe((status) => {
        console.log("[v0] Supplies subscription status:", status)
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected')
          setIsConnected(true)
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('disconnected')
          setIsConnected(false)
        } else {
          setConnectionStatus('connecting')
        }
      })

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
          console.log("[v0] Current categories count before update:", categories.length)
          try {
            if (payload.eventType === "INSERT") {
              const newCategory = {
                id: payload.new.id,
                name: payload.new.name,
                icon: payload.new.icon,
                isCustom: payload.new.is_custom,
              }
              console.log("[v0] Adding new category:", newCategory)
              setCategories((prev) => {
                const newCategories = [...prev, newCategory]
                console.log("[v0] Categories after INSERT:", newCategories.length)
                return newCategories
              })
            } else if (payload.eventType === "UPDATE") {
              const updatedCategory = {
                id: payload.new.id,
                name: payload.new.name,
                icon: payload.new.icon,
                isCustom: payload.new.is_custom,
              }
              console.log("[v0] Updating category:", updatedCategory)
              setCategories((prev) => {
                const updated = prev.map((c) => (c.id === updatedCategory.id ? updatedCategory : c))
                console.log("[v0] Categories after UPDATE:", updated.length)
                return updated
              })
            } else if (payload.eventType === "DELETE") {
              console.log("[v0] Deleting category:", payload.old.id)
              setCategories((prev) => {
                const filtered = prev.filter((c) => c.id !== payload.old.id)
                console.log("[v0] Categories after DELETE:", filtered.length)
                return filtered
              })
            }
          } catch (err) {
            console.error("[v0] Error handling categories realtime update:", err)
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
          try {
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
            } else if (payload.eventType === "UPDATE") {
              const updatedNotification = {
                id: payload.new.id,
                itemName: payload.new.item_name,
                category: payload.new.category,
                status: payload.new.status,
                timestamp: payload.new.timestamp,
                isRead: payload.new.is_read,
              }
              setNotifications((prev) => 
                prev.map((n) => n.id === updatedNotification.id ? updatedNotification : n)
              )
            } else if (payload.eventType === "DELETE") {
              setNotifications((prev) => 
                prev.filter((n) => n.id !== payload.old.id)
              )
            }
          } catch (err) {
            console.error("[v0] Error handling notification realtime update:", err)
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
    // Real-time subscriptions will be handled by the dedicated useEffect
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
    // Real-time subscriptions will be handled by the dedicated useEffect
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
        // Real-time subscriptions will be handled by the dedicated useEffect
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
      // Use updateSupply to ensure notifications are triggered when items become low/out
      await updateSupply(supplyId, { status: newStatus })
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
      // Real-time subscription will handle the UI update automatically
    } catch (error) {
      console.error("[v0] Error adding supply:", error)
    }
  }

  const handleDeleteSupply = async (supplyId: string) => {
    if (!householdId) return

    if (!confirm('Delete this item? This cannot be undone.')) return

    try {
      await supabase.from("supplies").delete().eq("id", supplyId).eq("household_id", householdId)
      // Real-time subscription will handle the UI update automatically
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
      // Real-time subscription will handle the UI update automatically
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
      // Real-time subscriptions will handle the UI updates automatically
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
      // Real-time subscription will handle the UI update automatically
      
      // Auto-trigger notifications if status was changed to low or out
      if (updates.status && (updates.status === 'low' || updates.status === 'out')) {
        try {
          console.log('[v0] Supply status changed to', updates.status, '- triggering notifications')
          await handleSendNotification()
        } catch (notifErr) {
          console.error('[v0] Auto-notification failed:', notifErr)
          // Don't fail the whole update if notification fails
        }
      }
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

      const padding = 48
      const lineHeight = 60 // Taller rows for better mobile visibility
      const categoryHeight = 60 // Taller category headers
      const headerHeight = 140
      let totalHeight = headerHeight + padding * 2

      Object.values(itemsByCategory).forEach((items) => {
        totalHeight += categoryHeight + items.length * lineHeight + 30
      })

      // Make canvas larger for better quality - matching your design
      canvas.width = 900
      canvas.height = totalHeight

      // Set up fonts matching your design
      const fonts = {
        title: "bold 40px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
        subtitle: "18px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif", 
        category: "bold 24px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
        item: "20px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
        status: "bold 14px system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
      }

      // Clean light background like your design
      ctx.fillStyle = "#f8f9fa"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Header section - clean white card like your design
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, headerHeight)
      
      // Shopping cart icon and title
      ctx.fillStyle = "#2d3748"
      ctx.font = fonts.title
      const titleText = "🛒 Shopping List"
      const titleWidth = ctx.measureText(titleText).width
      ctx.fillText(titleText, (canvas.width - titleWidth) / 2, 70)

      // Subtitle with date and count - matching your design
      ctx.fillStyle = "#718096"
      ctx.font = fonts.subtitle
      const dateText = `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`
      const dateWidth = ctx.measureText(dateText).width
      ctx.fillText(dateText, (canvas.width - dateWidth) / 2, 100)
      
      const itemCountText = `${neededItems.length} items to buy`
      const countWidth = ctx.measureText(itemCountText).width
      ctx.fillText(itemCountText, (canvas.width - countWidth) / 2, 125)

      let yPosition = headerHeight + 20

      Object.entries(itemsByCategory).forEach(([categoryId, items]) => {
        const category = categories.find((c) => c.id === categoryId)

        // Category header - exact green color from your design
        ctx.fillStyle = "#38a169" // Green color matching your design
        ctx.fillRect(20, yPosition, canvas.width - 40, categoryHeight)
        
        // White text on green background - category title
        ctx.fillStyle = "#ffffff"
        ctx.font = fonts.category
        const categoryText = `${category?.icon || "📦"} ${category?.name || "Unknown Category"}`
        ctx.fillText(categoryText, 40, yPosition + 38)
        
        // Item count on the right in white
        ctx.font = fonts.status
        const countText = `${items.length} item${items.length !== 1 ? 's' : ''}`
        const countTextWidth = ctx.measureText(countText).width
        ctx.fillText(countText, canvas.width - countTextWidth - 40, yPosition + 38)
        
        yPosition += categoryHeight

        items.forEach((item, index) => {
          // White background for items (clean design)
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(20, yPosition, canvas.width - 40, lineHeight)

          // Orange/red left border indicator like your design
          ctx.fillStyle = "#e53e3e" // Red border like your design
          ctx.fillRect(20, yPosition, 6, lineHeight)

          // Item name - matching your typography
          ctx.fillStyle = "#2d3748"
          ctx.font = fonts.item
          ctx.fillText(`${item.name}`, 50, yPosition + 38)

          // Status badge on the right - matching your design
          const statusText = item.status === "low" ? "Low Stock" : "Out of Stock"
          const badgeColor = item.status === "low" ? "#f6ad55" : "#e53e3e"
          
          // Calculate badge dimensions
          ctx.font = fonts.status
          const statusWidth = ctx.measureText(statusText).width + 20
          const badgeX = canvas.width - statusWidth - 40
          const badgeY = yPosition + 15
          
          // Draw badge background
          ctx.fillStyle = badgeColor
          ctx.fillRect(badgeX, badgeY, statusWidth, 30)
          
          // Badge text in white
          ctx.fillStyle = "#ffffff"
          ctx.fillText(statusText, badgeX + 10, badgeY + 20)

          yPosition += lineHeight
        })

        yPosition += 20 // Space between categories
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

    // Show share options menu for better UX
    const shareMethod = await showMobileShareMenu()
    
    if (shareMethod === 'cancel') {
      return
    }

    const text = generateShoppingListText(neededItems, itemsByCategory)

    switch (shareMethod) {
      case 'whatsapp':
        await shareViaWhatsApp(text)
        break
      case 'sms':
        await shareViaSMS(text)
        break
      case 'email':
        await shareViaEmail(text)
        break
      case 'native':
        await shareViaNativeAPI(text)
        break
      case 'copy':
        await copyToClipboard(text)
        break
      case 'canvas':
        try {
          await exportCanvasForMobile(neededItems, itemsByCategory)
        } catch (err) {
          console.log('[v0] Canvas export failed, falling back to text copy:', err)
          await copyToClipboard(text)
        }
        break
      default:
        // Fallback to the original flow
        await originalMobileExport(text, neededItems, itemsByCategory)
    }
  }

  const generateShoppingListText = (neededItems: Supply[], itemsByCategory: Record<string, Supply[]>): string => {
    let text = '🛒 SHOPPING LIST\n'
    text += `📅 ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}\n`
    text += `📊 ${neededItems.length} items need attention\n\n`
    
    Object.entries(itemsByCategory).forEach(([categoryId, items]) => {
      const category = categories.find((c) => c.id === categoryId)
      text += `${category?.icon || "📦"} ${category?.name || "Unknown Category"}:\n`
      items.forEach((item, index) => {
        const status = item.status === "low" ? "🟡 LOW" : "🔴 OUT"
        text += `  ${index + 1}. ${item.name} ${status}\n`
      })
      text += '\n'
    })
    
    text += '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
    text += '📱 Generated by Household Supplies Manager\n'
    text += '💡 Tip: Check items off as you shop!'
    
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
    // Median.co apps have strict limitations, but we can still offer multiple sharing options
    
    const itemsByCategory: Record<string, Supply[]> = {}
    neededItems.forEach((item) => {
      if (!itemsByCategory[item.category]) {
        itemsByCategory[item.category] = []
      }
      itemsByCategory[item.category].push(item)
    })

    const text = generateShoppingListText(neededItems, itemsByCategory)
    
    // Show sharing options specific to Median.co environment
    const shareMethod = await showMedianShareMenu()
    
    switch (shareMethod) {
      case 'whatsapp':
        await shareViaWhatsApp(text)
        break
      case 'sms':
        await shareViaSMS(text)
        break
      case 'email':
        await shareViaEmail(text)
        break
      case 'copy':
        await copyToClipboard(text)
        break
      case 'cancel':
        return
      default:
        // Default to clipboard as most reliable in WebView
        await copyToClipboard(text)
    }
  }
  
  const showMedianShareMenu = (): Promise<string> => {
    return new Promise((resolve) => {
      const options = [
        { key: 'whatsapp', label: '� Open in WhatsApp' },
        { key: 'sms', label: '📱 Send via SMS' },
        { key: 'email', label: '📧 Send via Email' },
        { key: 'copy', label: '📋 Copy to Clipboard' },
        { key: 'cancel', label: '❌ Cancel' }
      ]

      const message = "Choose how to share your shopping list:\n\n" + 
        options.map((opt, idx) => `${idx + 1}. ${opt.label}`).join('\n')

      const choice = prompt(message + "\n\nEnter the number (1-5):")
      
      if (!choice || choice === '5' || choice.toLowerCase() === 'cancel') {
        resolve('cancel')
        return
      }

      const selectedIndex = parseInt(choice) - 1
      if (selectedIndex >= 0 && selectedIndex < options.length - 1) {
        resolve(options[selectedIndex].key)
      } else {
        alert('Invalid choice. Defaulting to copy to clipboard.')
        resolve('copy')
      }
    })
  }
  
  const showMobileShareMenu = (): Promise<string> => {
    return new Promise((resolve) => {
      // Create a simple dialog with share options
      const options = [
        { key: 'whatsapp', label: '💬 Share via WhatsApp', icon: '💬' },
        { key: 'sms', label: '📱 Share via SMS', icon: '📱' },
        { key: 'email', label: '📧 Share via Email', icon: '📧' },
        { key: 'native', label: '📤 Share (Native)', icon: '📤' },
        { key: 'copy', label: '📋 Copy to Clipboard', icon: '📋' },
        { key: 'canvas', label: '🖼️ Download as Image', icon: '🖼️' },
        { key: 'cancel', label: '❌ Cancel', icon: '❌' }
      ]

      const message = "How would you like to share your shopping list?\n\n" + 
        options.map((opt, idx) => `${idx + 1}. ${opt.label}`).join('\n')

      const choice = prompt(message + "\n\nEnter the number (1-7):")
      
      if (!choice || choice === '7' || choice.toLowerCase() === 'cancel') {
        resolve('cancel')
        return
      }

      const selectedIndex = parseInt(choice) - 1
      if (selectedIndex >= 0 && selectedIndex < options.length - 1) {
        resolve(options[selectedIndex].key)
      } else {
        alert('Invalid choice. Defaulting to copy to clipboard.')
        resolve('copy')
      }
    })
  }

  const shareViaWhatsApp = async (text: string) => {
    try {
      const encodedText = encodeURIComponent(text)
      const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedText}`
      
      // Try to open WhatsApp
      window.open(whatsappUrl, '_blank')
      
      // Also copy to clipboard as backup
      await copyToClipboard(text)
      alert('✅ Opening WhatsApp...\n\nThe shopping list has also been copied to your clipboard as backup!')
    } catch (err) {
      console.error('[v0] WhatsApp share failed:', err)
      alert('Failed to open WhatsApp. Copying to clipboard instead.')
      await copyToClipboard(text)
    }
  }

  const shareViaSMS = async (text: string) => {
    try {
      const encodedText = encodeURIComponent(text)
      const smsUrl = `sms:?body=${encodedText}`
      
      // Try to open SMS app
      window.location.href = smsUrl
      
      // Also copy to clipboard as backup
      await copyToClipboard(text)
      alert('✅ Opening SMS app...\n\nThe shopping list has also been copied to your clipboard as backup!')
    } catch (err) {
      console.error('[v0] SMS share failed:', err)
      alert('Failed to open SMS app. Copying to clipboard instead.')
      await copyToClipboard(text)
    }
  }

  const shareViaEmail = async (text: string) => {
    try {
      const subject = encodeURIComponent('🛒 Shopping List')
      const body = encodeURIComponent(text)
      const emailUrl = `mailto:?subject=${subject}&body=${body}`
      
      // Try to open email app
      window.location.href = emailUrl
      
      // Also copy to clipboard as backup
      await copyToClipboard(text)
      alert('✅ Opening email app...\n\nThe shopping list has also been copied to your clipboard as backup!')
    } catch (err) {
      console.error('[v0] Email share failed:', err)
      alert('Failed to open email app. Copying to clipboard instead.')
      await copyToClipboard(text)
    }
  }

  const shareViaNativeAPI = async (text: string) => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: '🛒 Shopping List',
          text: text,
        })
      } else {
        throw new Error('Native share API not supported')
      }
    } catch (err) {
      console.log('[v0] Native share failed:', err)
      alert('Native sharing not available. Copying to clipboard instead.')
      await copyToClipboard(text)
    }
  }

  const copyToClipboard = async (text: string) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text)
        alert('✅ Shopping list copied to clipboard!\n\nYou can now paste it in any app (WhatsApp, SMS, Notes, etc.)')
        return
      }
      
      // Fallback to textarea method
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      
      const successful = document.execCommand('copy')
      document.body.removeChild(textarea)
      
      if (successful) {
        alert('✅ Shopping list copied to clipboard!\n\nYou can now paste it in any app (WhatsApp, SMS, Notes, etc.)')
      } else {
        throw new Error('Copy command failed')
      }
    } catch (err) {
      console.error('[v0] Clipboard copy failed:', err)
      alert(`Unable to copy automatically. Here's your shopping list:\n\n${text}\n\nPlease manually copy this text.`)
    }
  }

  const originalMobileExport = async (text: string, neededItems: Supply[], itemsByCategory: Record<string, Supply[]>) => {
    // Original mobile export logic as fallback
    try {
      // Try Web Share API first (modern mobile browsers)
      if (navigator.share) {
        await navigator.share({
          title: '🛒 Shopping List',
          text: text,
        })
        return
      }

      // Try canvas with mobile-specific settings
      await exportCanvasForMobile(neededItems, itemsByCategory)
    } catch (err) {
      console.log('[v0] Original mobile export failed:', err)
      await copyToClipboard(text)
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

  // Main dashboard return
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      {/* Enhanced Header with better mobile layout */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex flex-col space-y-3 sm:space-y-0 sm:flex-row sm:items-center sm:justify-between">
            {/* Logo and Status Section */}
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-emerald-700 truncate">
                🏠 Household Supplies
              </h1>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs sm:text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  Logged in as <Badge variant="secondary" className="text-xs px-2 py-1">{userRole}</Badge>
                </span>
                {connectionStatus === 'connected' ? (
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs px-2 py-1">
                    <Wifi className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">Live Sync</span>
                    <span className="sm:hidden">🟢</span>
                  </Badge>
                ) : connectionStatus === 'connecting' ? (
                  <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 text-xs px-2 py-1">
                    <Wifi className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">Connecting...</span>
                    <span className="sm:hidden">🟡</span>
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs px-2 py-1">
                    <WifiOff className="h-3 w-3 mr-1" />
                    <span className="hidden sm:inline">Offline</span>
                    <span className="sm:hidden">🔴</span>
                  </Badge>
                )}
              </div>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 sm:gap-3 flex-wrap">
              {userRole === "husband" && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => router.push("/notifications")} 
                  className="flex-shrink-0 h-8 sm:h-9 px-2 sm:px-3"
                >
                  <Bell className="h-4 w-4" />
                  <span className="hidden sm:inline ml-2">Notifications</span>
                </Button>
              )}
              <Button 
                onClick={handleLogout} 
                variant="outline" 
                size="sm" 
                className="flex-shrink-0 h-8 sm:h-9 px-2 sm:px-3"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline ml-2">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content with improved spacing */}
      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 max-w-7xl">
        {/* Top Info Cards Grid - Better responsive layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
          {/* Household Code Card - Takes full width on mobile, 2 cols on md+ */}
          <Card className="md:col-span-2 xl:col-span-2 border-blue-200 bg-blue-50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="text-blue-700 text-base sm:text-lg lg:text-xl flex items-center gap-2">
                🔗 Household Code
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-blue-600">
                Share this code with your partner to sync devices in real-time
              </CardDescription>
              
              {/* Code Display - Better mobile layout */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-3 sm:mt-4">
                <code className="flex-1 text-base sm:text-lg lg:text-xl font-bold bg-white p-3 sm:p-4 rounded-lg border-2 text-center min-h-[48px] sm:min-h-[52px] flex items-center justify-center tracking-wider shadow-inner">
                  {householdId}
                </code>
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(householdId || "")
                    alert("Code copied to clipboard!")
                  }}
                  variant="outline"
                  size="sm"
                  className="bg-white hover:bg-blue-50 min-h-[48px] sm:min-h-[52px] px-4 sm:px-6 font-medium border-2"
                >
                  <Copy className="h-4 w-4" />
                  <span className="ml-2">Copy Code</span>
                </Button>
              </div>
              
              {householdId && (
                <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-white border border-blue-100 rounded-lg">
                  <p className="text-xs sm:text-sm font-medium text-blue-700 mb-2">
                    📱 Share this household code
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Share the code above with your partner so they can join using the "Enter Household Code" option.
                  </p>
                </div>
              )}
            </CardHeader>
          </Card>

          {/* Backup & Export Card */}
          <Card className="border-purple-200 bg-purple-50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="text-purple-700 text-base sm:text-lg flex items-center gap-2">
                💾 Backup & Export
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-purple-600">
                Export or share your supply list
              </CardDescription>
              
              <div className="flex flex-col gap-2 sm:gap-3 mt-3 sm:mt-4">
                {userRole === 'husband' ? (
                  <Button 
                    onClick={handleExportAsImage} 
                    variant="outline" 
                    className="bg-white hover:bg-purple-50 w-full justify-start min-h-[44px] border-2" 
                    disabled={isImporting || isExportingImage}
                    size="sm"
                  >
                    <ImageIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span className="text-sm font-medium">
                      {isExportingImage ? "Exporting..." : "Export as Image"}
                    </span>
                  </Button>
                ) : (
                  <>
                    <Button 
                      onClick={handleExportData} 
                      variant="outline" 
                      className="bg-white hover:bg-purple-50 w-full justify-start min-h-[44px] border-2" 
                      disabled={isImporting}
                      size="sm"
                    >
                      <Download className="h-4 w-4 mr-2 flex-shrink-0" />
                      <span className="text-sm font-medium">Export JSON</span>
                    </Button>
                    <Button 
                      onClick={handleImportData} 
                      variant="outline" 
                      className="bg-white hover:bg-purple-50 w-full justify-start min-h-[44px] border-2" 
                      disabled={isImporting}
                      size="sm"
                    >
                      <Upload className="h-4 w-4 mr-2 flex-shrink-0" />
                      <span className="text-sm font-medium">
                        {isImporting ? "Importing..." : "Import JSON"}
                      </span>
                    </Button>
                  </>
                )}
              </div>
            </CardHeader>
          </Card>
        </div>

        {/* Low/Out Supplies Alert - Enhanced for wife role */}
        {userRole === "wife" && lowOrOutSupplies.length > 0 && (
          <Card className="mb-6 sm:mb-8 border-orange-200 bg-orange-50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-3 sm:pb-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <CardTitle className="text-orange-700 text-base sm:text-lg flex items-center gap-2">
                    ⚠️ Items Need Attention
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-orange-600 mt-1">
                    {lowOrOutSupplies.length} item{lowOrOutSupplies.length !== 1 ? "s" : ""} 
                    {lowOrOutSupplies.length === 1 ? " is" : " are"} low or out of stock
                  </CardDescription>
                  
                  {/* Quick preview of items */}
                  <div className="mt-2 sm:mt-3">
                    <div className="flex flex-wrap gap-1 sm:gap-2">
                      {lowOrOutSupplies.slice(0, 3).map((supply) => (
                        <Badge 
                          key={supply.id} 
                          variant={supply.status === "out" ? "destructive" : "secondary"}
                          className="text-xs px-2 py-1"
                        >
                          {supply.name}
                        </Badge>
                      ))}
                      {lowOrOutSupplies.length > 3 && (
                        <Badge variant="outline" className="text-xs px-2 py-1">
                          +{lowOrOutSupplies.length - 3} more
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <Button 
                    onClick={handleExportAsImage} 
                    variant="outline" 
                    className="bg-white hover:bg-orange-50 min-h-[44px] border-2" 
                    size="sm"
                    disabled={isImporting || isExportingImage}
                  >
                    <ImageIcon className="h-4 w-4 mr-2 flex-shrink-0" />
                    <span className="text-sm font-medium">
                      {isExportingImage ? "Exporting..." : "Export Shopping List"}
                    </span>
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        )}

        {/* Category Management Section - Enhanced for wife role */}
        {userRole === "wife" && (
          <div className="mb-6 sm:mb-8">
            {!showAddCategory ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 sm:p-6 bg-white rounded-lg border-2 border-dashed border-emerald-200 hover:border-emerald-300 transition-colors">
                <div className="flex-1">
                  <h3 className="font-semibold text-emerald-700 text-sm sm:text-base">
                    🗂️ Manage Categories
                  </h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                    Create custom categories to organize your supplies better
                  </p>
                </div>
                <Button 
                  onClick={() => setShowAddCategory(true)} 
                  variant="outline" 
                  className="w-full sm:w-auto bg-emerald-50 hover:bg-emerald-100 border-emerald-300 min-h-[44px]"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  <span className="font-medium">Add New Category</span>
                </Button>
              </div>
            ) : (
              <Card className="border-emerald-200 bg-emerald-50 shadow-sm">
                <CardHeader className="pb-3 sm:pb-4">
                  <div className="flex items-start justify-between mb-3 sm:mb-4">
                    <div>
                      <CardTitle className="text-emerald-700 text-base sm:text-lg flex items-center gap-2">
                        ➕ Create New Category
                      </CardTitle>
                      <CardDescription className="text-xs sm:text-sm text-emerald-600 mt-1">
                        Add a custom category with name and emoji icon
                      </CardDescription>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setShowAddCategory(false)}
                      className="flex-shrink-0 h-8 w-8 p-0 hover:bg-emerald-100"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  
                  <div className="space-y-3 sm:space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <div className="sm:col-span-3">
                        <Input
                          placeholder="Category name (e.g., Beverages, Snacks)"
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          className="w-full min-h-[44px] bg-white border-2 focus:border-emerald-300 text-sm"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <Input
                          placeholder="🥤"
                          value={newCategoryIcon}
                          onChange={(e) => setNewCategoryIcon(e.target.value)}
                          className="w-full min-h-[44px] bg-white border-2 focus:border-emerald-300 text-center text-lg"
                          maxLength={2}
                        />
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                      <Button 
                        onClick={handleAddCategory} 
                        className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto min-h-[44px] font-medium"
                        disabled={!newCategoryName.trim() || !newCategoryIcon.trim()}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create Category
                      </Button>
                      <Button 
                        onClick={() => setShowAddCategory(false)} 
                        variant="outline" 
                        className="w-full sm:w-auto min-h-[44px] bg-white border-2"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            )}
          </div>
        )}

        {/* Categories Grid Section - Enhanced responsive layout */}
        <div className="space-y-4 sm:space-y-6">
          {/* Categories Header with Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 p-4 sm:p-6 bg-white rounded-lg border shadow-sm">
            <div className="flex-1">
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
                📋 Supply Categories
              </h2>
              <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                {categories.length} categor{categories.length !== 1 ? "ies" : "y"} • {supplies.length} total items
              </p>
            </div>
            
            {/* Category Controls */}
            <div className="flex items-center gap-2 sm:gap-3">
              <Button 
                onClick={() => setGlobalOpenState(false)} 
                variant="outline" 
                size="sm"
                className="flex-1 sm:flex-none min-h-[36px] text-xs sm:text-sm"
              >
                📂 Collapse All
              </Button>
              <Button 
                onClick={() => setGlobalOpenState(true)} 
                variant="outline" 
                size="sm"
                className="flex-1 sm:flex-none min-h-[36px] text-xs sm:text-sm"
              >
                📁 Expand All
              </Button>
            </div>
          </div>

          {/* Categories Grid with improved responsive design */}
          <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {categories.length === 0 ? (
              /* Empty State */
              <div className="col-span-full">
                <Card className="border-dashed border-2 border-gray-200 bg-gray-50">
                  <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16">
                    <div className="text-4xl sm:text-6xl mb-4">📦</div>
                    <h3 className="text-lg sm:text-xl font-semibold text-gray-700 mb-2">No Categories Yet</h3>
                    <p className="text-sm sm:text-base text-muted-foreground text-center max-w-md">
                      {userRole === "wife" 
                        ? "Create your first category to start organizing your household supplies."
                        : "Your partner will set up the supply categories for you to manage."
                      }
                    </p>
                    {userRole === "wife" && (
                      <Button 
                        onClick={() => setShowAddCategory(true)} 
                        className="mt-4 bg-emerald-600 hover:bg-emerald-700"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Create First Category
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>
            ) : (
              /* Categories List */
              categories.map((category) => (
                <div key={category.id} className="h-fit">
                  <SupplyCategory
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
                </div>
              ))
            )}
          </div>
          
          {/* Quick Stats Footer */}
          {categories.length > 0 && (
            <div className="mt-6 sm:mt-8">
              <Card className="bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200">
                <CardContent className="p-4 sm:p-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-lg sm:text-2xl font-bold text-emerald-700">
                        {supplies.filter(s => s.status === 'available').length}
                      </div>
                      <div className="text-xs sm:text-sm text-emerald-600">Available</div>
                    </div>
                    <div>
                      <div className="text-lg sm:text-2xl font-bold text-orange-700">
                        {supplies.filter(s => s.status === 'low').length}
                      </div>
                      <div className="text-xs sm:text-sm text-orange-600">Running Low</div>
                    </div>
                    <div>
                      <div className="text-lg sm:text-2xl font-bold text-red-700">
                        {supplies.filter(s => s.status === 'out').length}
                      </div>
                      <div className="text-xs sm:text-sm text-red-600">Out of Stock</div>
                    </div>
                    <div>
                      <div className="text-lg sm:text-2xl font-bold text-blue-700">
                        {categories.length}
                      </div>
                      <div className="text-xs sm:text-sm text-blue-600">Categories</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
