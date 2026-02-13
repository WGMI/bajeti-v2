"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  FolderTree,
  Calendar,
  Receipt,
  PiggyBank,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", icon: Home, label: "Dashboard" },
  { href: "/dashboard/transactions", icon: Receipt, label: "Transactions" },
  { href: "/dashboard/categories", icon: FolderTree, label: "Categories" },
  { href: "/dashboard/monthly", icon: Calendar, label: "Monthly view" },
  { href: "/dashboard/settings", icon: Settings, label: "Settings" },
];

export function SidebarNavContent({ onLinkClick }: { onLinkClick?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <Link
        href="/dashboard"
        className="flex items-center gap-2 p-4 md:p-5"
        onClick={onLinkClick}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <PiggyBank className="h-6 w-6" />
        </div>
        <span className="text-lg font-semibold">Bajeti</span>
      </Link>
      <nav className="flex flex-1 flex-col gap-1 px-2 py-4 md:px-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onLinkClick}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
              )}
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function DashboardSidebar() {
  return (
    <aside className="hidden w-16 flex-col border-r bg-sidebar md:flex md:w-20 lg:w-56">
      <div className="relative flex flex-col">
        <SidebarNavContent />
      </div>
    </aside>
  );
}
