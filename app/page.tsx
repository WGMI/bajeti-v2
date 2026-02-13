import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, PiggyBank, TrendingUp, Shield, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function LandingPage() {
  const { userId } = await auth();
  if (userId) redirect("/dashboard");
  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-primary/5">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-primary/10 bg-background/90 backdrop-blur-md">
        <div className="container flex h-14 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <PiggyBank className="h-5 w-5" />
            </div>
            <span className="text-xl font-semibold tracking-tight">Bajeti</span>
          </div>
          <nav className="hidden gap-6 md:flex">
            <Link
              href="#features"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Features
            </Link>
            <Link
              href="#how-it-works"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              How it works
            </Link>
          </nav>
          <Link href="/dashboard">
            <Button size="sm" className="rounded-full px-4">
              Get started
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="container px-4 py-16 sm:px-6 sm:py-24 md:py-32">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Take control of your money with{" "}
            <span className="bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">simple budgeting</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground sm:text-xl">
            Track spending, set goals, and see where your money goes—all in one
            clean dashboard. No spreadsheets, no hassle.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link href="/dashboard">
              <Button size="lg" className="w-full rounded-full px-8 sm:w-auto">
                Open dashboard
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Button variant="outline" size="lg" className="w-full rounded-full px-8 sm:w-auto" asChild>
              <Link href="#features">See features</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="container border-t border-primary/5 bg-muted/30 px-4 py-16 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Everything you need to stay on budget
          </h2>
          <p className="mt-4 text-muted-foreground">
            A single place to view earnings, spending, and goals.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: PieChart,
              title: "Earning & spending summary",
              description:
                "See your balance, savings rate, and earning vs spending at a glance.",
              color: "bg-chart-1/15 text-chart-1",
            },
            {
              icon: TrendingUp,
              title: "Payment statistics",
              description:
                "Track weekly and monthly trends with clear, simple charts.",
              color: "bg-chart-2/15 text-chart-2",
            },
            {
              icon: Shield,
              title: "Goals & budgets",
              description:
                "Set goals for bills, travel, shopping, and daily expenses with progress bars.",
              color: "bg-chart-5/15 text-chart-5",
            },
          ].map((item) => (
            <div
              key={item.title}
              className={cn(
                "rounded-2xl border border-primary/5 bg-card p-6 shadow-sm transition-shadow hover:shadow-md hover:border-primary/10"
              )}
            >
              <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", item.color)}>
                <item.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="container px-4 py-16 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-2xl rounded-3xl border border-primary/10 bg-card p-8 text-center shadow-sm sm:p-12">
          <h2 className="text-2xl font-bold sm:text-3xl">
            Ready to manage your budget?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Start tracking your money in under a minute. No sign-up required to
            try the dashboard.
          </p>
          <Link href="/dashboard" className="mt-6 inline-block">
            <Button size="lg" className="rounded-full px-8">
              Go to dashboard
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container flex flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Bajeti</span>
          </div>
          <p className="text-sm text-muted-foreground">
            A simple personal budgeting tool.
          </p>
        </div>
      </footer>
    </div>
  );
}
