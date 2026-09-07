import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ArrowRight, PiggyBank, MessageSquare, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmsParseDemo } from "@/components/landing/sms-parse-demo";
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
            <Image
              src="/bajeti-app-icon.png"
              alt=""
              width={36}
              height={36}
              className="h-9 w-9 rounded-lg shadow-sm"
              priority
            />
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
      <section className="container px-4 py-16 sm:px-6 sm:py-24 md:py-28">
        <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-8">
          <div className="text-center lg:text-left">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              The budget app that reads your{" "}
              <span className="bg-gradient-to-r from-primary to-chart-2 bg-clip-text text-transparent">
                M-Pesa messages
              </span>{" "}
              for you
            </h1>
            <p className="mt-6 text-lg text-muted-foreground">
              Every M-Pesa and bank SMS becomes a categorized transaction the moment it
              arrives — no manual entry, no spreadsheets. That&apos;s not a screenshot on
              the right, it&apos;s Bajeti&apos;s real parser. Try it.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row lg:justify-start">
              <Link href="/dashboard">
                <Button size="lg" className="w-full rounded-full px-8 sm:w-auto">
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Button variant="outline" size="lg" className="w-full rounded-full px-8 sm:w-auto" asChild>
                <Link href="#features">See what else it does</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              We&apos;re onboarding a small first group of users while we polish Bajeti —
              expect the occasional rough edge.
            </p>
          </div>
          <SmsParseDemo />
        </div>
      </section>

      {/* Features */}
      <section
        id="features"
        className="container border-t border-primary/5 bg-muted/30 px-4 py-16 sm:px-6 sm:py-24"
      >
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Beyond manual entry
          </h2>
          <p className="mt-4 text-muted-foreground">
            The parts of Bajeti a spreadsheet, or a typical budgeting app, can&apos;t do.
          </p>
        </div>
        <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: MessageSquare,
              title: "SMS auto-import",
              description:
                "M-Pesa and bank messages turn into categorized transactions automatically, in the background, the moment they land.",
              color: "bg-chart-1/15 text-chart-1",
            },
            {
              icon: Sparkles,
              title: "Ask your budget a question",
              description:
                "Speak a transaction out loud, or ask “how much did I spend on transport this month” and get a real answer, not a chart to squint at.",
              color: "bg-chart-2/15 text-chart-2",
            },
            {
              icon: Users,
              title: "Shared budgets",
              description:
                "Invite a partner, roommate, or family member into a group budget you both can see and add to.",
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
            Ready to stop typing in your own transactions?
          </h2>
          <p className="mt-4 text-muted-foreground">
            Create your private account and start tracking your money in under a
            minute. We&apos;re a small, early product right now — reach out any time
            something doesn&apos;t make sense.
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
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              Privacy policy
            </Link>
            <Link href="/delete-account" className="transition-colors hover:text-foreground">
              Delete account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
