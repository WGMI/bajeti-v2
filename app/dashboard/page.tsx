"use client";

import { EarningSummaryCard } from "@/components/dashboard/earning-summary-card";
import { PaymentStatisticsCard } from "@/components/dashboard/payment-statistics-card";
import { ActivityGraphCard } from "@/components/dashboard/activity-graph-card";
import { RecentTransactionsCard } from "@/components/dashboard/recent-transactions-card";
import { useBudget } from "@/lib/budget-store";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const { loading, error, refetch } = useBudget();

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

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <EarningSummaryCard />
        <PaymentStatisticsCard />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentTransactionsCard />
        </div>
        <div className="space-y-6">
          <ActivityGraphCard />
        </div>
      </div>
    </div>
  );
}
