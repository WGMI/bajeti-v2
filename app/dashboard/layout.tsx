import { Suspense } from "react";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { FloatingActionButton } from "@/components/dashboard/floating-action-button";
import { GlobalAddTransactionDialog } from "@/components/dashboard/global-add-transaction-dialog";
import { GlobalAddCategoryDialog } from "@/components/dashboard/global-add-category-dialog";
import { BudgetProvider } from "@/lib/budget-store";
import { SettingsProvider } from "@/lib/settings-store";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SettingsProvider>
      <BudgetProvider>
      <div className="flex min-h-screen min-w-0 flex-col md:flex-row">
        <DashboardSidebar />
        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          <DashboardHeader />
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-muted/20 p-4 pb-[max(1rem,calc(5.5rem+env(safe-area-inset-bottom,0px)))] md:p-6 md:pb-6">
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <FloatingActionButton />
          <GlobalAddTransactionDialog />
          <GlobalAddCategoryDialog />
        </Suspense>
      </div>
    </BudgetProvider>
    </SettingsProvider>
  );
}
