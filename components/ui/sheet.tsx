"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SheetContextValue {
  open: boolean
  setOpen: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextValue | null>(null)

const Sheet = ({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}) => {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = open !== undefined
  const isOpen = isControlled ? open : internalOpen
  const setOpen = React.useCallback(
    (v: boolean) => {
      if (!isControlled) setInternalOpen(v)
      onOpenChange?.(v)
    },
    [isControlled, onOpenChange]
  )
  return (
    <SheetContext.Provider value={{ open: isOpen, setOpen }}>
      {children}
    </SheetContext.Provider>
  )
}

const SheetTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, children, onClick, ...props }, ref) => {
  const ctx = React.useContext(SheetContext)
  if (!ctx) return null
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      onClick={(e) => {
        ctx.setOpen(true)
        onClick?.(e)
      }}
      {...props}
    >
      {children}
    </button>
  )
})
SheetTrigger.displayName = "SheetTrigger"

const SheetContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { side?: "left" | "right" }
>(({ className, side = "left", children, ...props }, ref) => {
  const ctx = React.useContext(SheetContext)
  if (!ctx) return null
  if (!ctx.open) return null
  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/80"
        onClick={() => ctx.setOpen(false)}
        aria-hidden
      />
      <div
        ref={ref}
        className={cn(
          "fixed inset-y-0 z-50 flex w-3/4 max-w-sm flex-col gap-4 border-r bg-background p-6 shadow-lg transition-transform duration-300 ease-out sm:max-w-sm",
          side === "left" ? "left-0" : "right-0",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </>
  )
})
SheetContent.displayName = "SheetContent"

export { Sheet, SheetTrigger, SheetContent }
