import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export const metadata = {
  title: "Privacy Policy | Bajeti",
  description: "How Bajeti collects, uses, protects, and deletes your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Bajeti
        </Link>

        <header className="mb-10">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-muted-foreground">
            Effective July 1, 2026
          </p>
        </header>

        <div className="space-y-8 text-sm leading-7 text-muted-foreground sm:text-base">
          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              About this policy
            </h2>
            <p>
              This policy explains how Bajeti collects, uses, protects, and
              deletes information when you use the Bajeti website and Android
              app. Bajeti is a personal budgeting service; it does not hold,
              transfer, or lend money.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Information we collect
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                Account information, such as your email address, name, and
                authentication identifiers.
              </li>
              <li>
                Budgeting information you provide, including transactions,
                amounts, categories, accounts, notes, preferences, and rules.
              </li>
              <li>
                With your explicit Android permission, SMS messages from
                senders you choose for transaction importing. Messages are
                sent to Bajeti to identify financial transactions and create
                entries in your private account.
              </li>
              <li>
                Essential technical information needed to operate, secure, and
                troubleshoot the service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              How we use information
            </h2>
            <p>
              We use your information only to authenticate you, provide
              budgeting features, parse transaction messages you choose to
              import, synchronize your account across devices, maintain
              security, and respond to support requests. We do not sell your
              personal or financial information, use SMS content for
              advertising, or share it with data brokers.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              SMS access and control
            </h2>
            <p>
              SMS access is optional and is requested only when you use SMS
              importing. You choose which sender to import from and can revoke
              permission at any time in Android settings. Bajeti transmits the
              selected messages over an encrypted connection and encrypts
              stored SMS text and financial values at rest. Only the
              authenticated account holder can view this information through
              Bajeti. Bajeti&apos;s automated systems process and decrypt it
              only as needed to provide the service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Service providers and sharing
            </h2>
            <p>
              Bajeti relies on service providers for authentication, hosting,
              and database infrastructure, including Clerk, Vercel, and Neon.
              They process information only to provide their contracted
              services and are subject to their own security and privacy
              obligations. We may also disclose information when legally
              required or necessary to protect users and the service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Security and retention
            </h2>
            <p>
              We use authenticated access controls, encrypted network
              connections, and application-level encryption for stored SMS
              text, transaction notes, and financial values. We retain account
              data while your account is active and delete it when you delete
              your account, except where limited retention is legally required
              for security, fraud prevention, or compliance.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Your choices and account deletion
            </h2>
            <p>
              You can revoke SMS permission, edit or delete transactions, and
              permanently delete your Bajeti account from Settings in the
              Android app. Account deletion removes your Bajeti financial
              records, preferences, and authentication account. See the{" "}
              <Link
                href="/delete-account"
                className="font-medium text-primary underline underline-offset-4"
              >
                account deletion page
              </Link>{" "}
              for details.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Children
            </h2>
            <p>
              Bajeti is not directed to children under 13, and we do not
              knowingly collect personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-xl font-semibold text-foreground">
              Changes and contact
            </h2>
            <p>
              We may update this policy as the service changes. The effective
              date above will be updated when material changes are made. For
              privacy questions or deletion help, email{" "}
              <a
                href="mailto:privacy@bajeti.app"
                className="font-medium text-primary underline underline-offset-4"
              >
                privacy@bajeti.app
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
