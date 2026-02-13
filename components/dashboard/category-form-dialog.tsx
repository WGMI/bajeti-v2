"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useBudget } from "@/lib/budget-store";
import type { Category } from "@/lib/budget-types";

interface CategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingCategory?: Category | null;
}

function getInitialValues(editingCategory: Category | null | undefined) {
  if (editingCategory) {
    return { name: editingCategory.name, type: editingCategory.type as "income" | "expense" };
  }
  return { name: "", type: "expense" as const };
}

function CategoryFormFields({
  editingCategory,
  onClose,
}: {
  editingCategory: Category | null | undefined;
  onClose: () => void;
}) {
  const { categories, addCategory, updateCategory } = useBudget();
  const isEdit = !!editingCategory;
  const initial = getInitialValues(editingCategory);
  const [name, setName] = useState(initial.name);
  const [type, setType] = useState<"income" | "expense">(initial.type);

  const isDuplicateName = (trimmed: string) => {
    const lower = trimmed.toLowerCase();
    return categories.some(
      (c) =>
        c.name.toLowerCase() === lower &&
        (isEdit ? c.id !== editingCategory!.id : true)
    );
  };

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<{
    name: string;
    type: "income" | "expense";
  } | null>(null);

  const doSubmit = async (payload: { name: string; type: "income" | "expense" }) => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (isEdit && editingCategory) {
        await updateCategory(editingCategory.id, payload);
      } else {
        await addCategory(payload);
      }
      setPendingSubmit(null);
      setDuplicateDialogOpen(false);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    if (isDuplicateName(trimmed)) {
      setPendingSubmit({ name: trimmed, type });
      setDuplicateDialogOpen(true);
      return;
    }

    await doSubmit({ name: trimmed, type });
  };

  const handleDuplicateConfirm = () => {
    if (pendingSubmit) {
      doSubmit(pendingSubmit);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="cat-name">Name</Label>
        <Input
          id="cat-name"
          placeholder="e.g. Groceries"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cat-type">Type</Label>
        <Select
          value={type}
          onValueChange={(v) => setType(v as "income" | "expense")}
        >
          <SelectTrigger id="cat-type">
            {type === "income" ? "Income" : "Expense"}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="expense">Expense</SelectItem>
            <SelectItem value="income">Income</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {submitError && (
        <p className="text-sm text-destructive">{submitError}</p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Create category"}
        </Button>
      </DialogFooter>

      <Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Category already exists</DialogTitle>
            <DialogDescription>
              A category named &quot;{pendingSubmit?.name}&quot; already exists.{" "}
              {isEdit ? "Save with this name anyway?" : "Create anyway?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDuplicateDialogOpen(false);
                setPendingSubmit(null);
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDuplicateConfirm}
              disabled={submitting}
            >
              {submitting ? "Saving…" : isEdit ? "Save anyway" : "Create anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  editingCategory,
}: CategoryFormDialogProps) {
  const isEdit = !!editingCategory;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit category" : "Create category"}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <CategoryFormFields
            key={editingCategory?.id ?? "new"}
            editingCategory={editingCategory}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
