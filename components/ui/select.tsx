"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SelectContextValue {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const SelectContext = React.createContext<SelectContextValue | null>(null)

const Select = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    value?: string
    onValueChange?: (value: string) => void
    defaultValue?: string
  }
>(({ className, children, value: controlledValue, onValueChange, defaultValue = "", ...props }, ref) => {
  const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
  const [open, setOpen] = React.useState(false)
  const value = controlledValue !== undefined ? controlledValue : uncontrolledValue
  const handleChange = React.useCallback(
    (v: string) => {
      if (controlledValue === undefined) setUncontrolledValue(v)
      onValueChange?.(v)
    },
    [controlledValue, onValueChange]
  )
  return (
    <SelectContext.Provider value={{ value, onValueChange: handleChange, open, setOpen }}>
      <div ref={ref} className={cn("relative", className)} {...props}>
        {children}
      </div>
    </SelectContext.Provider>
  )
})
Select.displayName = "Select"

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }
>(({ className, children, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx) return null
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        className
      )}
      onClick={() => ctx.setOpen(!ctx.open)}
      {...props}
    >
      {children}
    </button>
  )
})
SelectTrigger.displayName = "SelectTrigger"

const SelectContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }
>(({ className, children, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx || !ctx.open) return null
  return (
    <div
      ref={ref}
      className={cn(
        "absolute left-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
SelectContent.displayName = "SelectContent"

const SelectItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, children, value, ...props }, ref) => {
  const ctx = React.useContext(SelectContext)
  if (!ctx) return null
  const selected = ctx.value === value
  return (
    <div
      ref={ref}
      role="option"
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        selected && "bg-accent",
        className
      )}
      onClick={() => {
        ctx.onValueChange(value)
        ctx.setOpen(false)
      }}
      {...props}
    >
      {children}
    </div>
  )
})
SelectItem.displayName = "SelectItem"

export { Select, SelectTrigger, SelectContent, SelectItem }
