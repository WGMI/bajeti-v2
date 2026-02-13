"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    value?: number;
    indicatorClassName?: string;
    indicatorStyle?: React.CSSProperties;
  }
>(({ className, value = 0, indicatorClassName, indicatorStyle, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}
  >
    <div
      className={cn("h-full bg-primary transition-all duration-300 ease-in-out", indicatorClassName)}
      style={{ width: `${Math.min(100, Math.max(0, value))}%`, ...indicatorStyle }}
    />
  </div>
))
Progress.displayName = "Progress"

export { Progress }
