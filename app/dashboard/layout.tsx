import { Suspense } from "react";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { FloatingActionButton } from "@/components/dashboard/floating-action-button";
import { GlobalAddTransactionDialog } from "@/components/dashboard/global-add-transaction-dialog";
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
      <div className="flex min-h-screen flex-col md:flex-row">
        <DashboardSidebar />
        <div className="flex flex-1 flex-col min-h-screen">
          <DashboardHeader />
          <main className="flex-1 p-4 md:p-6 bg-muted/20 overflow-auto">
            {children}
          </main>
        </div>
        <Suspense fallback={null}>
          <FloatingActionButton />
          <GlobalAddTransactionDialog />
        </Suspense>
      </div>
    </BudgetProvider>
    </SettingsProvider>
  );
}
