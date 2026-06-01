"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { Pencil, Trash2, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export default function AccountsPage() {
  const router = useRouter();
  const { accounts, loading, error, refetch, addAccount, updateAccount, deleteAccount } =
    useBudget();
  const { currency } = useSettings();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="font-medium text-destructive">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await addAccount(name);
      setNewName("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add account");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await updateAccount(id, name);
      setEditingId(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update account");
    } finally {
      setSubmitting(false);
    }
  };

  const openAccountTransactions = (accountId: string) => {
    router.push(`/dashboard/transactions?accountId=${accountId}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Every transaction belongs to an account. Click a card to view its transactions.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input
                id="account-name"
                placeholder="e.g. Savings"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={submitting}>
              Add
            </Button>
          </form>
          {formError && <p className="mt-2 text-sm text-destructive">{formError}</p>}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => {
          const balance = account.balance ?? 0;
          const totalIn = account.totalIn ?? 0;
          const totalOut = account.totalOut ?? 0;
          const isEditing = editingId === account.id;

          return (
            <Card
              key={account.id}
              role="button"
              tabIndex={0}
              onClick={() => !isEditing && openAccountTransactions(account.id)}
              onKeyDown={(e) => {
                if (isEditing) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openAccountTransactions(account.id);
                }
              }}
              className={cn(
                "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isEditing && "cursor-default hover:bg-transparent"
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{account.name}</span>
                  <span className="flex items-center gap-2">
                    {account.isDefault && (
                      <span className="text-xs font-normal text-muted-foreground">Default</span>
                    )}
                    {!isEditing && (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                    )}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3" onClick={(e) => isEditing && e.stopPropagation()}>
                <div>
                  <p className="text-xs text-muted-foreground">Balance</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {formatCurrency(balance, currency)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Money in</p>
                    <p className="font-medium text-success tabular-nums">
                      {formatCurrency(totalIn, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Money out</p>
                    <p className="font-medium tabular-nums">{formatCurrency(totalOut, currency)}</p>
                  </div>
                </div>
                {isEditing ? (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      disabled={account.isDefault}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveEdit(account.id)}
                      disabled={submitting || account.isDefault}
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(account.id);
                        setEditName(account.name);
                      }}
                      disabled={account.isDefault}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="text-white"
                      disabled={account.isDefault || submitting}
                      onClick={async () => {
                        setSubmitting(true);
                        try {
                          await deleteAccount(account.id);
                        } catch (err) {
                          setFormError(
                            err instanceof Error ? err.message : "Failed to delete account"
                          );
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
