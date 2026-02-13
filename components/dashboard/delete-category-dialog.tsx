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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import type { Category } from "@/lib/budget-types";

export type DeleteCategoryAction = "reassign" | "delete-transactions";

interface DeleteCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: Category | null;
  transactionCount: number;
  otherCategoriesSameType: Category[];
  onConfirm: (
    action: DeleteCategoryAction,
    reassignToCategoryId?: string
  ) => void;
  deleting?: boolean;
}

function ReassignSelect({
  defaultId,
  otherCategoriesSameType,
  deleting,
  onReassign,
}: {
  defaultId: string;
  otherCategoriesSameType: Category[];
  deleting: boolean;
  onReassign: (id: string) => void;
}) {
  const [reassignToId, setReassignToId] = useState(defaultId);

  const handleReassign = () => {
    if (reassignToId) onReassign(reassignToId);
  };

  return (
    <div className="space-y-2">
      <Label>Recategorise transactions</Label>
      <Select value={reassignToId} onValueChange={setReassignToId}>
        <SelectTrigger disabled={deleting}>
          {otherCategoriesSameType.find((c) => c.id === reassignToId)?.name ??
            "Select category"}
        </SelectTrigger>
        <SelectContent>
          {otherCategoriesSameType.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        className="w-full sm:w-auto"
        variant="default"
        onClick={handleReassign}
        disabled={deleting || !reassignToId}
      >
        {deleting ? "Deleting…" : "Recategorise and delete"}
      </Button>
    </div>
  );
}

export function DeleteCategoryDialog({
  open,
  onOpenChange,
  category,
  transactionCount,
  otherCategoriesSameType,
  onConfirm,
  deleting = false,
}: DeleteCategoryDialogProps) {
  const defaultId =
    otherCategoriesSameType.find((c) => c.isDefault)?.id ??
    otherCategoriesSameType[0]?.id ??
    "";

  const handleDeleteTransactions = () => {
    onConfirm("delete-transactions");
  };

  const canReassign = otherCategoriesSameType.length > 0;
  const reassignKey = open && category ? category.id : "closed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete category</DialogTitle>
          <DialogDescription>
            {category && (
              <>
                <span className="font-medium text-foreground">{category.name}</span>
                {transactionCount > 0 ? (
                  <> has {transactionCount} transaction{transactionCount !== 1 ? "s" : ""}. Choose how to proceed.</>
                ) : (
                  <> will be deleted.</>
                )}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {transactionCount > 0 && (
          <div className="space-y-4 py-2">
            {canReassign && (
              <ReassignSelect
                key={reassignKey}
                defaultId={defaultId}
                otherCategoriesSameType={otherCategoriesSameType}
                deleting={deleting}
                onReassign={(id) => onConfirm("reassign", id)}
              />
            )}

            <div className="space-y-2">
              <Label className="text-destructive">
                {canReassign ? "Or delete transactions" : "Delete transactions"}
              </Label>
              <p className="text-sm text-muted-foreground">
                Permanently delete all {transactionCount} transaction
                {transactionCount !== 1 ? "s" : ""} in this category and then
                delete the category.
              </p>
              <Button
                className="w-full sm:w-auto text-white"
                variant="destructive"
                onClick={handleDeleteTransactions}
                disabled={deleting}
              >
                {deleting ? "Deleting…" : "Delete transactions and category"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          {transactionCount === 0 && (
            <Button
              variant="destructive"
              onClick={() => onConfirm("delete-transactions")}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete category"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
