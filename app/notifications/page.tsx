"use client"

import { Suspense } from "react"
import { NotificationsView } from "@/components/notifications-view"

export default function NotificationsPage() {
  return (
    <Suspense fallback={<div>Loading notifications...</div>}>
      <NotificationsView />
    </Suspense>
  )
}
