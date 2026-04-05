"use client";

import { useState, useCallback } from "react";
import { CounterpartyMapSuggestions } from "@/components/dashboard/counterparty-map-suggestions";
import { CounterpartySavedRules } from "@/components/dashboard/counterparty-saved-rules";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function RulesPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="min-w-0 mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">SMS category rules</h1>
        <p className="text-sm text-muted-foreground">
          Map recurring payees and payers from your bank SMS to categories. Applying a rule
          updates existing transactions and future imports.
        </p>
      </div>

      <Tabs defaultValue="created" className="w-full">
        <TabsList className="w-full max-w-md">
          <TabsTrigger value="created">Created rules</TabsTrigger>
          <TabsTrigger value="suggested">Suggested rules</TabsTrigger>
        </TabsList>
        <TabsContent value="created">
          <CounterpartySavedRules refreshKey={refreshKey} onRulesChanged={bumpRefresh} />
        </TabsContent>
        <TabsContent value="suggested">
          <CounterpartyMapSuggestions refreshKey={refreshKey} onMapped={bumpRefresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
