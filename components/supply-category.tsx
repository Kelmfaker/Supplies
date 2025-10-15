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
    <Card className="h-fit shadow-sm hover:shadow-md transition-all duration-200 border-l-4 border-l-emerald-300">
      <CardHeader className="pb-3 sm:pb-4">
        <CardTitle className="flex items-center gap-2 sm:gap-3 text-base sm:text-lg">
          {/* Expand/Collapse Button */}
          <Button 
            size="sm" 
            variant="ghost" 
            className="h-7 w-7 sm:h-8 sm:w-8 p-0 flex-shrink-0 hover:bg-emerald-50" 
            onClick={(e) => { 
              e.stopPropagation(); 
              const next = !isOpen; 
              setIsOpen(next); 
              onUserToggle?.(next); 
            }} 
            aria-label={isOpen ? 'Collapse category' : 'Expand category'}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
          
          {/* Category Icon and Name */}
          <span className="text-xl sm:text-2xl flex-shrink-0">{category.icon}</span>
          <span className="font-semibold text-gray-900 truncate min-w-0 flex-1">{category.name}</span>
          
          {/* Supply Count Badge */}
          <Badge 
            variant="secondary" 
            className="ml-auto flex-shrink-0 text-xs px-2 py-1 bg-emerald-100 text-emerald-700 border-emerald-200"
          >
            {supplies.length}
          </Badge>
          
          {/* Action Buttons - Only for wife role */}
          {isWife && (
            <div className="flex items-center gap-1 ml-2">
              {onUpdateCategory && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsEditing(true)
                  }}
                  className="h-7 w-7 sm:h-8 sm:w-8 p-0 hover:bg-blue-50 text-blue-600"
                  title="Edit category"
                >
                  ✏️
                </Button>
              )}
              {onDeleteCategory && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete category "${category.name}"? This will also delete all items in this category.`)) {
                      onDeleteCategory(category.id)
                    }
                  }}
                  className="h-7 w-7 sm:h-8 sm:w-8 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                  title="Delete category"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </CardTitle>
        
        {/* Quick Status Summary */}
        {supplies.length > 0 && (
          <div className="flex items-center gap-2 mt-2 text-xs">
            {supplies.filter(s => s.status === 'available').length > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                {supplies.filter(s => s.status === 'available').length} OK
              </span>
            )}
            {supplies.filter(s => s.status === 'low').length > 0 && (
              <span className="flex items-center gap-1 text-orange-600">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                {supplies.filter(s => s.status === 'low').length} Low
              </span>
            )}
            {supplies.filter(s => s.status === 'out').length > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                {supplies.filter(s => s.status === 'out').length} Out
              </span>
            )}
          </div>
        )}
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
