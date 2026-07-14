import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";

export const metadata = {
  title: "Delete Your Account | Bajeti",
  description: "How to permanently delete your Bajeti account and data.",
};

export default function DeleteAccountPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Bajeti
        </Link>

        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
          <Trash2 className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Delete your Bajeti account
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          In the Bajeti Android app, open <strong>More</strong>, choose{" "}
          <strong>Settings</strong>, then select{" "}
          <strong>Delete account and data</strong>. Confirm the warning to
          permanently delete your authentication account, transactions,
          categories, accounts, imported SMS data, rules, and preferences.
        </p>

        <div className="mt-8 rounded-2xl border bg-card p-6">
          <h2 className="text-lg font-semibold">No longer have the app?</h2>
          <p className="mt-2 leading-7 text-muted-foreground">
            Send a deletion request from the email address associated with your
            Bajeti account to{" "}
            <a
              href="mailto:privacy@bajeti.app?subject=Bajeti%20account%20deletion%20request"
              className="font-medium text-primary underline underline-offset-4"
            >
              privacy@bajeti.app
            </a>
            . We may verify account ownership before completing the request.
          </p>
        </div>

        <p className="mt-8 text-sm leading-6 text-muted-foreground">
          Deletion is permanent and cannot be undone. See our{" "}
          <Link
            href="/privacy"
            className="font-medium text-primary underline underline-offset-4"
          >
            Privacy Policy
          </Link>{" "}
          for more information.
        </p>
      </div>
    </main>
  );
}
