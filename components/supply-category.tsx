"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, X } from "lucide-react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { Supply, Category } from "@/components/supply-dashboard"

type SupplyCategoryProps = {
  category: Category
  supplies: Supply[]
  onStatusChange: (supplyId: string, newStatus: "available" | "low" | "out") => void
  onAddSupply: (categoryId: string, name: string) => void
  onDeleteSupply: (supplyId: string) => void
  onDeleteCategory?: (categoryId: string) => void
  onUpdateCategory?: (categoryId: string, updates: { name?: string; icon?: string }) => Promise<void>
  onUpdateSupply?: (supplyId: string, updates: { name?: string; status?: Supply['status'] }) => Promise<void>
  isWife: boolean
  // Optional: parent can force open/closed all categories by passing a boolean
  globalOpen?: boolean | null
  // Notify parent when user manually toggles this category (to clear global forcing)
  onUserToggle?: (open: boolean) => void
}

export function SupplyCategory({
  category,
  supplies,
  onStatusChange,
  onAddSupply,
  onDeleteSupply,
  onDeleteCategory,
    onUpdateCategory,
  onUpdateSupply,
  isWife,
  globalOpen,
  onUserToggle,
}: SupplyCategoryProps) {
  const [isAdding, setIsAdding] = useState(false)
  const [newItemName, setNewItemName] = useState("")
  const [isOpen, setIsOpen] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(category.name)
  const [editIcon, setEditIcon] = useState(category.icon)
  const [isSaving, setIsSaving] = useState(false)
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null)
  const [editingSupplyName, setEditingSupplyName] = useState<string>('')
  const [editingSupplyStatus, setEditingSupplyStatus] = useState<Supply['status']>('available')

  // If parent passes globalOpen (true/false) we follow it; null means let local control
  useEffect(() => {
    if (typeof globalOpen === 'boolean') {
      setIsOpen(globalOpen)
    }
  }, [globalOpen])

  const handleAdd = () => {
    if (newItemName.trim()) {
      onAddSupply(category.id, newItemName.trim())
      setNewItemName("")
      setIsAdding(false)
    }
  }

  const getStatusColor = (status: Supply["status"]) => {
    switch (status) {
      case "available":
        return "bg-green-500 hover:bg-green-600"
      case "low":
        return "bg-orange-500 hover:bg-orange-600"
      case "out":
        return "bg-red-500 hover:bg-red-600"
    }
  }

  const getNextStatus = (currentStatus: Supply["status"]): Supply["status"] => {
    switch (currentStatus) {
      case "available":
        return "low"
      case "low":
        return "out"
      case "out":
        return "available"
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 mr-1" onClick={(e) => { e.stopPropagation(); const next = !isOpen; setIsOpen(next); onUserToggle?.(next); }} aria-label={isOpen ? 'Collapse category' : 'Expand category'}>
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          <span className="text-2xl">{category.icon}</span>
          {category.name}
          <Badge variant="secondary" className="ml-auto">
            {supplies.length}
          </Badge>
          {isWife && onDeleteCategory && (
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteCategory(category.id)
              }}
              className="h-8 w-8 p-0 ml-1 text-red-500 hover:text-red-700 hover:bg-red-50"
              title="Delete category"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
          {isWife && onUpdateCategory && (
            <div className="ml-2 flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(true)
                }}
                className="h-8 w-8 p-0"
                title="Edit category"
              >
                ✏️
              </Button>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      {isOpen && (
        <CardContent className="space-y-2">
          {isEditing && onUpdateCategory && (
            <div className="mb-3 p-3 bg-white border rounded">
              <div className="flex gap-2 items-center">
                <Input
                  value={editIcon}
                  onChange={(e) => setEditIcon(e.target.value)}
                  className="w-12"
                  maxLength={2}
                  disabled={isSaving}
                />
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-36"
                  disabled={isSaving}
                />
              </div>
              <div className="mt-2 flex gap-2">
                <Button
                  size="sm"
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (!onUpdateCategory) return
                    setIsSaving(true)
                    try {
                      await onUpdateCategory(category.id, { name: editName.trim(), icon: editIcon.trim() })
                    } finally {
                      setIsSaving(false)
                      setIsEditing(false)
                    }
                  }}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsEditing(false)
                    setEditName(category.name)
                    setEditIcon(category.icon)
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {supplies.map((supply) => (
           <div key={supply.id}>
             <div className="flex items-center gap-2 p-2">
               <span className="flex-1 text-sm">{supply.name}</span>
               <Badge
                 className={`${getStatusColor(supply.status)} cursor-pointer`}
                 onClick={(e) => {
                   e.stopPropagation()
                   onStatusChange(supply.id, getNextStatus(supply.status))
                 }}
                 title={`Click to mark ${getNextStatus(supply.status)}`}
                 role={'button'}
               >
                 {supply.status}
               </Badge>
               {isWife && (
                 <div className="flex items-center gap-2">
                   <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingSupplyId(supply.id); setEditingSupplyName(supply.name); setEditingSupplyStatus(supply.status) }} className="h-8 w-8 p-0">
                     ✏️
                   </Button>
                   <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); if (!confirm('Delete this item? This cannot be undone.')) return; onDeleteSupply(supply.id) }} className="h-8 w-8 p-0">
                     <Trash2 className="h-4 w-4" />
                   </Button>
                 </div>
               )}
             </div>

             {editingSupplyId === supply.id && (
               <div className="mt-2 p-3 bg-white border rounded">
                 <div className="flex gap-2 items-center">
                   <Input value={editingSupplyName} onChange={(e) => setEditingSupplyName(e.target.value)} className="flex-1" />
                   <select value={editingSupplyStatus} onChange={(e) => setEditingSupplyStatus(e.target.value as Supply['status'])} className="border rounded px-2 py-1">
                     <option value="available">available</option>
                     <option value="low">low</option>
                     <option value="out">out</option>
                   </select>
                 </div>
                 <div className="mt-2 flex gap-2">
                   <Button size="sm" onClick={async (e) => { e.stopPropagation(); if (!onUpdateSupply) return; try { await onUpdateSupply(supply.id, { name: editingSupplyName.trim(), status: editingSupplyStatus }); setEditingSupplyId(null) } catch (err) { console.error(err); alert('Update failed') } }}>
                     Save
                   </Button>
                   <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setEditingSupplyId(null) }}>Cancel</Button>
                 </div>
               </div>
             )}
           </div>
          ))}

          {isWife && (
            <>
              {isAdding ? (
                <div className="flex gap-2 pt-2">
                  <Input
                    placeholder="Item name"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                    autoFocus
                  />
                  <Button size="sm" onClick={(e) => { e.stopPropagation(); handleAdd() }}>
                    Add
                  </Button>
                  <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setIsAdding(false) }}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2 bg-transparent"
                  onClick={(e) => { e.stopPropagation(); setIsAdding(true) }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Item
                </Button>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}
