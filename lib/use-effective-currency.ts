"use client";

import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";

export function useEffectiveCurrency() {
  const { currency } = useSettings();
  const { groups, selectedGroupId } = useBudget();
  return groups.find((group) => group.id === selectedGroupId)?.currency ?? currency;
}
