-- Create categories table
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT NOT NULL,
  is_custom BOOLEAN DEFAULT false,
  household_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_categories_household ON categories(household_id);

-- Create supplies table
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

-- Create notifications table
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

-- Enable Row Level Security
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplies ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- Create policies that allow access based on household_id
-- DROP policies first to make this script safe to re-run in Supabase
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'allow_all_categories') THEN
    EXECUTE 'DROP POLICY IF EXISTS "allow_all_categories" ON categories';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'allow_all_supplies') THEN
    EXECUTE 'DROP POLICY IF EXISTS "allow_all_supplies" ON supplies';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'allow_all_notifications') THEN
    EXECUTE 'DROP POLICY IF EXISTS "allow_all_notifications" ON notifications';
  END IF;
END$$;

CREATE POLICY "allow_all_categories" ON categories
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_supplies" ON supplies
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_notifications" ON notifications
  FOR ALL USING (true) WITH CHECK (true);

-- Create household_members table to store invited partners
CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL,
  role TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  inviter_id TEXT,
  invite_token TEXT,
  invite_status TEXT DEFAULT 'pending', -- pending, accepted, revoked
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_email ON household_members(email);

ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
-- household_members policy
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy WHERE polname = 'allow_all_household_members') THEN
    EXECUTE 'DROP POLICY IF EXISTS "allow_all_household_members" ON household_members';
  END IF;
END$$;

CREATE POLICY "allow_all_household_members" ON household_members
  FOR ALL USING (true) WITH CHECK (true);
