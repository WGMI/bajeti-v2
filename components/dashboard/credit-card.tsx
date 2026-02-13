import { Card, CardContent } from "@/components/ui/card";
import { Wifi, CreditCard } from "lucide-react";

export function CreditCardWidget() {
  return (
    <Card className="overflow-hidden border-0 bg-gradient-to-br from-primary from-20% via-neutral-800 to-neutral-900 text-white shadow-lg">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <Wifi className="h-5 w-5 opacity-80" />
          <CreditCard className="h-6 w-6 opacity-80" />
        </div>
        <p className="mt-6 font-mono text-sm tracking-widest opacity-90">
          6375 8623 2454 2201
        </p>
        <p className="mt-4 text-sm font-medium">Vaishali Pitroda</p>
        <div className="mt-2 flex items-center justify-between text-xs opacity-80">
          <span>04/23</span>
          <div className="flex h-8 items-center">
            <div className="flex h-6 w-9 items-center justify-center rounded bg-white/20 text-[10px] font-bold">
              MC
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
