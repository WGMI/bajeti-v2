This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## API docs (mobile)

Authenticated REST endpoints for the mobile app are documented in [`docs/MOBILE-API.md`](docs/MOBILE-API.md) (summary, transactions list, settings, SMS). All routes use Clerk: `Authorization: Bearer <clerk_session_token>`.

## Transaction text encryption

Transaction `notes` and raw SMS bodies are encrypted before they are written to the database. Set `BAJETI_TEXT_ENCRYPTION_KEY` to a 32-byte base64 value in every environment that reads or writes transactions:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

After setting the key for an existing database, run the one-time backfill:

```bash
npm run backfill:encrypt-transaction-text
```

The backfill command loads `.env.local` and `.env` automatically.

Keep this key outside the database and do not rotate it without re-encrypting existing rows.

### Transaction amount encryption

Amounts, transaction charges, original foreign-currency amounts, and FX rates use
the same authenticated encryption key with field-specific context. Roll out the
schema and backfill before deploying the ciphertext-first application:

```bash
npm run migrate:encrypt-transaction-amounts
npm run backfill:encrypt-transaction-amounts
npm run audit:encrypt-transaction-amounts
```

After the new application version is deployed everywhere, remove legacy plaintext:

```bash
npm run finalize:encrypt-transaction-amounts
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
