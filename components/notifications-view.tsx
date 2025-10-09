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
  const router = useRouter()
  const supabase = createClient()

  // Inline component: dropdown + apply button to update a supply's status from a notification
  function StatusDropdown({ notification }: { notification: Notification }) {
    const [value, setValue] = useState<string>(notification.status)
    const [loading, setLoading] = useState(false)

    const apply = async () => {
      try {
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
      <div className="mt-2 flex items-center gap-2">
        <select value={value} onChange={(e) => setValue(e.target.value)} className="border rounded p-1 text-sm">
          <option value="available">Available</option>
          <option value="low">Running Low</option>
          <option value="out">Out of Stock</option>
        </select>
        <Button size="sm" onClick={apply} disabled={loading}>
          Apply
        </Button>
      </div>
    )
  }

  useEffect(() => {
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
    let channel: any = null
    if (hid) {
      ;(async () => {
        try {
          const { data } = await supabase.from('notifications').select('*').eq('household_id', hid).order('timestamp', { ascending: false })
          if (data) setNotifications(data.map((n: any) => ({ id: n.id, itemName: n.item_name, category: n.category, status: n.status, isRead: n.is_read, timestamp: n.timestamp })))
        } catch (err) {
          console.error('[v0] Failed to fetch notifications:', err)
        }
      })()

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

  if (!userRole) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center">
        <p className="text-lg text-muted-foreground">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      <header className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-emerald-700">Shopping Reminders</h1>
              <p className="text-sm text-muted-foreground">Items that need restocking</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-3xl">
        {uploadedFiles && uploadedFiles.length > 0 && (
          <Card className="mb-6 border-purple-200 bg-purple-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-purple-700">
                <FileImage className="h-5 w-5" />
                Uploaded Shopping Lists
              </CardTitle>
              <CardDescription>Images and PDFs uploaded by your spouse</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {uploadedFiles.map((file) => (
                <Card key={file.id} className="bg-white">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1">
                        <h3 className="font-semibold mb-2">{file.name}</h3>
                        {file.type.startsWith("image/") ? (
                          <img
                            src={file.data || "/placeholder.svg"}
                            alt={file.name}
                            className="w-full max-w-md rounded border border-gray-200"
                          />
                        ) : (
                          <div className="bg-gray-100 p-4 rounded border border-gray-200 text-center">
                            <FileImage className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                            <p className="text-sm text-gray-600">PDF Document</p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-3">
                          <Badge variant="secondary" className="text-xs">
                            {new Date(file.timestamp).toLocaleDateString()}
                          </Badge>
                          <Button size="sm" variant="outline" onClick={() => handleDownloadFile(file)}>
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

        {notifications.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <ShoppingCart className="h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">All Stocked Up!</h2>
              <p className="text-muted-foreground text-center">
                There are no items that need restocking at the moment.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <Card className="border-orange-200 bg-orange-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-700">
                  <AlertCircle className="h-5 w-5" />
                  {notifications.length} Item{notifications.length !== 1 ? "s" : ""} Need Attention
                </CardTitle>
                <CardDescription>Please restock these items when you get a chance</CardDescription>
              </CardHeader>
            </Card>

            {notifications.map((notification) => (
              <Card key={notification.id} className="hover:shadow-md transition-shadow">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="text-3xl">📦</div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg">{notification.itemName}</h3>
                    <p className="text-sm text-muted-foreground">{notification.category}</p>
                    <StatusDropdown notification={notification} />
                  </div>
                  <Badge
                    className={
                      notification.status === "out"
                        ? "bg-red-500 hover:bg-red-600"
                        : "bg-orange-500 hover:bg-orange-600"
                    }
                  >
                    {notification.status === "out" ? "Out of Stock" : "Running Low"}
                  </Badge>
                </CardContent>
              </Card>
            ))}

            <Card className="bg-emerald-50 border-emerald-200">
              <CardContent className="p-4">
                <p className="text-sm text-emerald-700 text-center">
                  💡 Tip: Check the dashboard regularly to stay updated on household supplies
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
