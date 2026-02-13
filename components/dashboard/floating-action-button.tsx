"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, TrendingUp, TrendingDown, Tags } from "lucide-react";

export function FloatingActionButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const openAddTransaction = (type: "income" | "expense") => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("add", type);
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 md:bottom-8 md:right-8">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="lg"
            className="h-14 w-14 rounded-full shadow-lg hover:shadow-xl transition-shadow"
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
          <DropdownMenuItem onClick={() => router.push("/dashboard/categories?add=1")}>
            <Tags className="h-4 w-4 mr-2" />
            Add category
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
