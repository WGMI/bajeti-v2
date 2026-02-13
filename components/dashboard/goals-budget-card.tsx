import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileText, Globe, ShoppingBag, ListTodo } from "lucide-react";

const goals = [
  { icon: FileText, name: "Recharge & Bills", percent: 74, color: "var(--chart-1)" },
  { icon: Globe, name: "Travel", percent: 43, color: "var(--chart-2)" },
  { icon: ShoppingBag, name: "Shopping", percent: 61, color: "var(--chart-3)" },
  { icon: ListTodo, name: "Daily Basic Expense", percent: 87, color: "var(--chart-5)" },
];

export function GoalsBudgetCard() {
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Goals Budget</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {goals.map((goal) => (
          <div key={goal.name} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <goal.icon className="h-4 w-4 shrink-0" style={{ color: goal.color }} />
                <span>{goal.name}</span>
              </div>
              <span className="font-medium" style={{ color: goal.color }}>{goal.percent}%</span>
            </div>
            <Progress
              value={goal.percent}
              className="h-2"
              indicatorStyle={{ backgroundColor: goal.color }}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
