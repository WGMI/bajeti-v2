"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import type { Category } from "@/lib/budget-types";
import { CategoryFormDialog } from "@/components/dashboard/category-form-dialog";
import {
  DeleteCategoryDialog,
  type DeleteCategoryAction,
} from "@/components/dashboard/delete-category-dialog";

export default function CategoriesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { categories, transactions, deleteCategory, loading, error, refetch } =
    useBudget();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (searchParams.get("add")) {
      setEditingCat(null);
      setDialogOpen(true);
    }
  }, [searchParams]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive font-medium">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const openEdit = (cat: Category) => {
    setEditingCat(cat);
    setDialogOpen(true);
  };

  const handleDeleteClick = (cat: Category) => {
    const count = transactions.filter((t) => t.categoryId === cat.id).length;
    if (count > 0) {
      setCategoryToDelete(cat);
      setDeleteDialogOpen(true);
    } else {
      deleteCategory(cat.id);
    }
  };

  const handleDeleteConfirm = async (
    action: DeleteCategoryAction,
    reassignToCategoryId?: string
  ) => {
    if (!categoryToDelete) return;
    setDeleting(true);
    try {
      if (action === "reassign" && reassignToCategoryId) {
        await deleteCategory(categoryToDelete.id, {
          reassignToCategoryId,
        });
      } else {
        await deleteCategory(categoryToDelete.id, {
          deleteTransactions: true,
        });
      }
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const incomeCategories = categories.filter((c) => c.type === "income");
  const expenseCategories = categories.filter((c) => c.type === "expense");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Categories</h1>
          <p className="text-muted-foreground">
            Manage income and expense categories.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <span className="rounded-full bg-success/15 p-1.5 text-success">↑</span>
              Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {incomeCategories.map((cat) => (
                <li
                  key={cat.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span className="font-medium">{cat.name}</span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(cat)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(cat)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {incomeCategories.length === 0 && (
                <li className="text-sm text-muted-foreground py-2">No income categories.</li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <span className="rounded-full bg-muted p-1.5 text-muted-foreground">↓</span>
              Expense
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {expenseCategories.map((cat) => (
                <li
                  key={cat.id}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span className="font-medium">{cat.name}</span>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(cat)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => handleDeleteClick(cat)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
              {expenseCategories.length === 0 && (
                <li className="text-sm text-muted-foreground py-2">No expense categories.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      <CategoryFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open && searchParams.get("add")) {
            router.replace("/dashboard/categories");
          }
        }}
        editingCategory={editingCat}
      />

      <DeleteCategoryDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        category={categoryToDelete}
        transactionCount={
          categoryToDelete
            ? transactions.filter((t) => t.categoryId === categoryToDelete.id)
                .length
            : 0
        }
        otherCategoriesSameType={
          categoryToDelete
            ? categories.filter(
                (c) => c.type === categoryToDelete.type && c.id !== categoryToDelete.id
              )
            : []
        }
        onConfirm={handleDeleteConfirm}
        deleting={deleting}
      />
    </div>
  );
}
