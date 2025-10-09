"use client"

import { Suspense } from "react"
import { SupplyDashboard } from "@/components/supply-dashboard"

export default function DashboardPage() {
  return (
    <Suspense fallback={<div>Loading dashboard...</div>}>
      <SupplyDashboard />
    </Suspense>
  )
}
