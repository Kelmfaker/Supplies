# Household Supplies Organizer

A real-time household supplies management app for couples to track groceries, cleaning supplies, and more across multiple devices.

## Features

- **Real-time Synchronization**: Changes sync instantly between devices using Supabase
- **Role-Based Access**: Wife can manage all items, husband can update status while shopping
- **Custom Categories**: Create custom categories for any type of household supply
- **Smart Notifications**: Wife can send reminders to husband about items that need restocking
- **Status Tracking**: Track items as available, running low, or out of stock

## Getting Started

1. **First Time Setup**: Run the SQL script to create database tables
   - The script `scripts/001_create_tables.sql` will create the necessary tables and default categories

2. **Login**: Choose your role (Wife or Husband) on the home page

3. **Managing Supplies**:
   - **Wife**: Can add/delete items, change status, create custom categories, and send reminders
   - **Husband**: Can change item status while shopping to mark items as purchased

4. **Notifications**: Husband can view all items that need restocking in the Notifications page

## How It Works

- All data is stored in Supabase and syncs in real-time
- When the wife marks items as low/out, the husband sees updates instantly
- When the husband updates status while shopping, the wife sees changes immediately
- No user authentication needed - this is a shared household system

## Categories

Default categories include:
- 🥬 Vegetables
- 🍎 Fruits
- 🌶️ Spices
- 🧹 Cleaning Tools
- 🥛 Dairy
- 🌾 Grains & Cereals

You can add custom categories with your own names and emoji icons!
