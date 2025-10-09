import { createClient } from "@/lib/supabase/server"
import { NextResponse } from "next/server"

export async function POST() {
  const supabase = await createClient()

  try {
    // Create categories table
    const { error: categoriesError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          icon TEXT NOT NULL,
          is_custom BOOLEAN DEFAULT false,
          household_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_categories_household ON categories(household_id);
      `,
    })

    // Create supplies table
    const { error: suppliesError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS supplies (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('available', 'low', 'out')),
          category TEXT NOT NULL,
          household_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        
        CREATE INDEX IF NOT EXISTS idx_supplies_household ON supplies(household_id);
        CREATE INDEX IF NOT EXISTS idx_supplies_category ON supplies(category);
      `,
    })

    // Create notifications table
    const { error: notificationsError } = await supabase.rpc("exec_sql", {
      sql: `
        CREATE TABLE IF NOT EXISTS notifications (
          id TEXT PRIMARY KEY,
          item_name TEXT NOT NULL,
          category TEXT NOT NULL,
          status TEXT NOT NULL,
          timestamp TIMESTAMPTZ DEFAULT NOW(),
          is_read BOOLEAN DEFAULT false,
          household_id TEXT NOT NULL
        );
        
        CREATE INDEX IF NOT EXISTS idx_notifications_household ON notifications(household_id);
      `,
    })

    if (categoriesError || suppliesError || notificationsError) {
      throw new Error("Failed to create tables")
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Database setup error:", error)
    return NextResponse.json({ error: "Failed to setup database" }, { status: 500 })
  }
}
