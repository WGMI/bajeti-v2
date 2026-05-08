"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, TrendingUp, TrendingDown, ArrowLeftRight, Tags } from "lucide-react";

export function FloatingActionButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const openAddTransaction = (type: "income" | "expense" | "transfer") => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("add", type);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="fixed z-50 bottom-[max(1.5rem,calc(0.75rem+env(safe-area-inset-bottom,0px)))] right-[max(1.5rem,calc(0.75rem+env(safe-area-inset-right,0px)))] md:bottom-8 md:right-8">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            className="h-14 w-14 rounded-full border border-primary/20 bg-primary/35 text-primary-foreground shadow-lg backdrop-blur-md transition-[background-color,box-shadow,border-color,opacity] hover:border-primary/30 hover:bg-primary hover:shadow-xl active:bg-primary data-[state=open]:border-primary data-[state=open]:bg-primary data-[state=open]:shadow-xl focus-visible:bg-primary"
            aria-label="Add"
          >
            <Plus className="h-6 w-6" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" className="mb-2">
          <DropdownMenuItem onClick={() => openAddTransaction("income")}>
            <TrendingUp className="h-4 w-4 mr-2 text-success" />
            Add income
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openAddTransaction("expense")}>
            <TrendingDown className="h-4 w-4 mr-2" />
            Add expense
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => openAddTransaction("transfer")}>
            <ArrowLeftRight className="h-4 w-4 mr-2" />
            Add transfer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/dashboard/categories?add=1")}>
            <Tags className="h-4 w-4 mr-2" />
            Add category
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
