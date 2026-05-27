"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CategoryFormDialog } from "./category-form-dialog";

export function GlobalAddCategoryDialog() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const open = searchParams.get("add") === "category";

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("add");
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    }
  };

  return <CategoryFormDialog open={open} onOpenChange={onOpenChange} editingCategory={null} />;
}
