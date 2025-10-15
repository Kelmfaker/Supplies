"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, ShoppingCart, AlertCircle, FileImage, Download } from "lucide-react"

type Notification = {
  id: string
  itemName: string
  category: string
  status: "low" | "out"
  isRead: boolean
  timestamp: string
}

type UploadedFile = {
  id: string
  name: string
  type: string
  data: string
  timestamp: string
}

export function NotificationsView() {
  const [userRole, setUserRole] = useState<"wife" | "husband" | null>(null)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  // Inline component: dropdown + apply button to update a supply's status from a notification
  function StatusDropdown({ notification }: { notification: Notification }) {
    const [value, setValue] = useState<string>(notification.status)
    const [loading, setLoading] = useState(false)

    const apply = async () => {
      try {
        if (typeof window === 'undefined') return
        
        const hid = localStorage.getItem('householdId')
        if (!hid) return alert('No household id')
        setLoading(true)

        const newStatus = value

        // Try exact match first
        const { data: found } = await supabase.from('supplies').select('*').eq('household_id', hid).ilike('name', notification.itemName).limit(1)
        if (found && found.length > 0) {
          const supId = found[0].id
          await supabase.from('supplies').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', supId).eq('household_id', hid)
        } else {
          // fallback: partial match
          const { data: fuzzy } = await supabase.from('supplies').select('*').eq('household_id', hid).ilike('name', `%${notification.itemName}%`).limit(1)
          if (!fuzzy || fuzzy.length === 0) {
            alert('No matching supply found to update')
            setLoading(false)
            return
          }
          const supId = fuzzy[0].id
          await supabase.from('supplies').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', supId).eq('household_id', hid)
        }

        // mark notification read
        const { error: notifErr } = await supabase.from('notifications').update({ is_read: true }).eq('id', notification.id).eq('household_id', hid)
        if (notifErr) throw notifErr

        // update local view
        setNotifications((prev) => prev.filter((n) => n.id !== notification.id))
        alert('Item status updated')
      } catch (err) {
        console.error('[v0] Failed to update item status from notification:', err)
        alert('Failed to update item status')
      } finally {
        setLoading(false)
      }
    }

    return (
      <div className="mt-2 sm:mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
        <select 
          value={value} 
          onChange={(e) => setValue(e.target.value)} 
          className="flex-1 sm:flex-none border border-gray-300 rounded-md p-2 text-sm bg-white focus:border-emerald-300 focus:ring-1 focus:ring-emerald-300 min-h-[40px]"
        >
          <option value="available">✅ Available</option>
          <option value="low">🟡 Running Low</option>
          <option value="out">🔴 Out of Stock</option>
        </select>
        <Button 
          size="sm" 
          onClick={apply} 
          disabled={loading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[40px] px-4 font-medium"
        >
          {loading ? "Updating..." : "Update Status"}
        </Button>
      </div>
    )
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    
    let channel: any = null
    
    const initializeNotifications = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const role = localStorage.getItem("userRole") as "wife" | "husband" | null
        if (!role) {
          router.push("/")
          return
        }
        setUserRole(role)

        const savedNotifications = localStorage.getItem("notifications")
        if (savedNotifications) {
          setNotifications(JSON.parse(savedNotifications))
        }

        // If connected to a household, fetch notifications from Supabase
        const hid = localStorage.getItem('householdId')
        if (hid) {
          try {
            const { data } = await supabase.from('notifications').select('*').eq('household_id', hid).order('timestamp', { ascending: false })
            if (data) setNotifications(data.map((n: any) => ({ id: n.id, itemName: n.item_name, category: n.category, status: n.status, isRead: n.is_read, timestamp: n.timestamp })))
          } catch (err) {
            console.error('[v0] Failed to fetch notifications:', err)
            setError('Failed to fetch notifications')
          }

          // Setup realtime subscription to keep notifications in sync
          try {
            channel = supabase
              .channel(`notifications-${hid}`)
              .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notifications', filter: `household_id=eq.${hid}` },
                (payload: any) => {
                  try {
                    if (payload.eventType === 'INSERT') {
                      const n = payload.new
                      setNotifications((prev) => [{ id: n.id, itemName: n.item_name, category: n.category, status: n.status, isRead: n.is_read, timestamp: n.timestamp }, ...prev])
                    } else if (payload.eventType === 'UPDATE') {
                      const n = payload.new
                      setNotifications((prev) => prev.map((pn) => (pn.id === n.id ? { id: n.id, itemName: n.item_name, category: n.category, status: n.status, isRead: n.is_read, timestamp: n.timestamp } : pn)))
                    } else if (payload.eventType === 'DELETE') {
                      const old = payload.old
                      setNotifications((prev) => prev.filter((pn) => pn.id !== old.id))
                    }
                  } catch (e) {
                    console.error('[v0] Error handling notifications realtime payload:', e)
                  }
                },
              )
              .subscribe()
          } catch (e) {
            console.warn('[v0] Failed to setup notifications realtime subscription:', e)
          }
        }

        const savedFiles = localStorage.getItem("uploadedFiles")
        if (savedFiles) {
          setUploadedFiles(JSON.parse(savedFiles))
        }
      } catch (err) {
        console.error('[v0] Error initializing notifications:', err)
        setError('Failed to load notifications')
      } finally {
        setLoading(false)
      }
    }

    initializeNotifications()

    return () => {
      try {
        if (channel) supabase.removeChannel(channel)
      } catch (e) {
        // ignore
      }
    }
  }, [router])

  const handleDownloadFile = (file: UploadedFile) => {
    const link = document.createElement("a")
    link.href = file.data
    link.download = file.name
    link.click()
  }

  if (!userRole || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center">
        <p className="text-lg text-muted-foreground">Loading notifications...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="text-center p-6">
            <p className="text-red-600 mb-4">{error}</p>
            <Button onClick={() => window.location.reload()}>Try Again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      {/* Enhanced Header with better mobile layout */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-3 sm:px-4 lg:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => router.push("/dashboard")}
              className="flex-shrink-0 h-8 sm:h-9 px-2 sm:px-3"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline ml-2">Back</span>
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-emerald-700 truncate">
                🛒 Shopping Reminders
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                Items that need restocking
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-3 sm:px-4 lg:px-6 py-4 sm:py-6 lg:py-8 max-w-4xl">
        {/* Uploaded Files Section - Enhanced layout */}
        {uploadedFiles && uploadedFiles.length > 0 && (
          <Card className="mb-6 sm:mb-8 border-purple-200 bg-purple-50 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-3 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-purple-700 text-base sm:text-lg">
                <FileImage className="h-4 w-4 sm:h-5 sm:w-5" />
                📎 Uploaded Shopping Lists
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm text-purple-600">
                Images and PDFs uploaded by your spouse ({uploadedFiles.length} file{uploadedFiles.length !== 1 ? 's' : ''})
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 sm:space-y-4">
              {uploadedFiles.map((file) => (
                <Card key={file.id} className="bg-white border shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3 sm:gap-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold mb-2 sm:mb-3 text-sm sm:text-base truncate">{file.name}</h3>
                        {file.type.startsWith("image/") ? (
                          <div className="relative">
                            <img
                              src={file.data || "/placeholder.svg"}
                              alt={file.name}
                              className="w-full max-w-md rounded-lg border border-gray-200 shadow-sm"
                            />
                          </div>
                        ) : (
                          <div className="bg-gray-50 p-6 sm:p-8 rounded-lg border border-gray-200 text-center max-w-md">
                            <FileImage className="h-8 w-8 sm:h-12 sm:w-12 mx-auto mb-2 sm:mb-3 text-gray-400" />
                            <p className="text-xs sm:text-sm text-gray-600 font-medium">PDF Document</p>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-3">
                          <Badge variant="secondary" className="text-xs px-2 py-1">
                            📅 {new Date(file.timestamp).toLocaleDateString()}
                          </Badge>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            onClick={() => handleDownloadFile(file)}
                            className="h-8 text-xs"
                          >
                            <Download className="h-3 w-3 mr-1" />
                            Download
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Notifications Section - Enhanced responsive layout */}
        {notifications.length === 0 ? (
          <Card className="shadow-sm border-dashed border-2 border-gray-200">
            <CardContent className="flex flex-col items-center justify-center py-12 sm:py-16 px-4">
              <div className="text-4xl sm:text-6xl mb-4">🛒</div>
              <h2 className="text-lg sm:text-xl font-semibold mb-2 text-center">All Stocked Up!</h2>
              <p className="text-sm sm:text-base text-muted-foreground text-center max-w-md">
                There are no items that need restocking at the moment. Great job keeping everything in stock!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4 sm:space-y-6">
            {/* Notifications Header */}
            <Card className="border-orange-200 bg-orange-50 shadow-sm">
              <CardHeader className="pb-3 sm:pb-4">
                <CardTitle className="flex items-center gap-2 text-orange-700 text-base sm:text-lg">
                  <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5" />
                  ⚠️ {notifications.length} Item{notifications.length !== 1 ? "s" : ""} Need Attention
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm text-orange-600">
                  Please restock these items when you get a chance
                </CardDescription>
              </CardHeader>
            </Card>

            {/* Notifications List */}
            <div className="grid gap-3 sm:gap-4">
              {notifications.map((notification) => (
                <Card key={notification.id} className="hover:shadow-md transition-all duration-200 border-l-4 border-l-orange-300">
                  <CardContent className="p-3 sm:p-4">
                    <div className="flex items-start gap-3 sm:gap-4">
                      <div className="text-2xl sm:text-3xl flex-shrink-0">📦</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-semibold text-base sm:text-lg text-gray-900 truncate">
                              {notification.itemName}
                            </h3>
                            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                              Category: {notification.category}
                            </p>
                          </div>
                          <Badge
                            className={`flex-shrink-0 text-xs px-2 py-1 ${
                              notification.status === "out"
                                ? "bg-red-500 hover:bg-red-600 text-white"
                                : "bg-orange-500 hover:bg-orange-600 text-white"
                            }`}
                          >
                            {notification.status === "out" ? "🔴 Out of Stock" : "🟡 Running Low"}
                          </Badge>
                        </div>
                        
                        {/* Status Update Controls */}
                        <StatusDropdown notification={notification} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Tips Section */}
            <Card className="bg-emerald-50 border-emerald-200 shadow-sm">
              <CardContent className="p-4 sm:p-6">
                <div className="text-center">
                  <div className="text-2xl mb-2">💡</div>
                  <p className="text-xs sm:text-sm text-emerald-700 font-medium mb-1">
                    Pro Tip
                  </p>
                  <p className="text-xs sm:text-sm text-emerald-600">
                    Check the dashboard regularly to stay updated on household supplies and prevent running out of essentials.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
