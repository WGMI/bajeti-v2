# Receiving SMS from the Mobile App

This app can receive money-related SMS messages from your mobile app (with Clerk auth), parse them, and create transactions automatically.

For non-SMS mobile endpoints (summary + settings), see `docs/MOBILE-API.md`.

## Backend (this app)

- **Endpoint:** `POST /api/sms`
- **Auth:** Clerk. The request must include a valid Clerk session (same as your other API routes). The mobile app should send the session token so the backend can identify the user via `auth()`.

## Request format

```json
{
  "message": "Full SMS body text (e.g. M-PESA message)",
  "timestamp": 1710000000000
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | Raw SMS body. Parsed for amount, type (income/expense), date, and transaction charges. |
| `timestamp` | number | No | Unix ms; used for date when SMS has no date. |

## Response

- **200** – Success.
  - `parsed`: `{ message, type, amount, date, charges, transactionRef, counterparty, counterpartyKey, accountReference }` (type is `"income"` | `"expense"` | `"transfer"` | `"neither"`).
  - `transaction`: present only when a transaction was created (type income/expense/transfer, amount > 0, date present). Includes `transactionCharges` when the SMS contained fees (e.g. “Transaction cost”).
  - `status` can be:
    - `created` when a new transaction is inserted.
    - `duplicate` when the same SMS payload is resent (returns the existing transaction).
    - `ignored` when parser output is not actionable.
- **400** – Invalid body (e.g. missing `message`) or user has no category for the parsed type.
- **401** – Not authenticated (missing or invalid Clerk session).
- **500** – Server error.

## What the mobile app needs to do

1. **Use Clerk on the mobile app**  
   Sign the user in with Clerk (e.g. [Clerk React Native / Expo](https://clerk.com/docs/quickstarts/expo)) so you have a session.

2. **Send the session with the request**  
   When posting to `POST /api/sms`, include the Clerk session so the backend sees the same user:
   - **Option A:** Use Clerk’s `getToken()` and send `Authorization: Bearer <token>`.
   - **Option B:** If your app uses cookie-based sessions and the client supports cookies, use the same cookie (e.g. in a WebView or HTTP client that sends cookies).

3. **When you receive an SMS** (e.g. via Android SMS permission / listener), call:
   ```http
   POST https://your-bajeti-api-host/api/sms
   Content-Type: application/json
   Authorization: Bearer <clerk_session_token>

   { "message": "<full SMS body>", "timestamp": <optional_unix_ms> }
   ```

4. **Base URL**  
   Point the mobile app at your deployed Next.js app (e.g. `https://your-app.vercel.app`) or your dev URL (e.g. `http://localhost:3000` for local testing).

## Behavior

- The same parser as the web “Paste SMS” flow is used (`lib/sms-parser.ts`): M-PESA-style messages, KES amounts, “received” → income, “sent to” / “paid to” / etc. → expense.
- Transaction charges (e.g. “Transaction cost Ksh 7”) are parsed into `parsed.charges` and saved on the row as `transactionCharges`, separate from the principal `amount`.
- If the parsed type is `"income"` or `"expense"` and amount and date are present, a transaction is created using the user’s **first category** of that type (categories are created from defaults if the user has none).
- Duplicate prevention is idempotent: a deterministic key (`user + parsed type + amount + date + tx reference`) is stored on the transaction row, and duplicate SMS submissions return the existing transaction instead of creating a new one.
- Messages parsed as `"neither"` or “cancelled” or with zero amount do not create a transaction; the response still includes `parsed` for the client to show or log.

## Database migration

Before using transaction charges in production, run:

`psql $DATABASE_URL -f scripts/migrate-transaction-charges.sql`
