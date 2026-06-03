
# Mobile API

Reference for every authenticated API route under `app/api/`. All endpoints require Clerk authentication unless noted.

## Endpoint index

| Method | Path | Section |
|--------|------|---------|
| `GET` | `/api/summary` | [Summary](#1-summary-endpoint) |
| `GET` | `/api/accounts` | [Accounts](#2-accounts-endpoints) |
| `POST` | `/api/accounts` | [Accounts](#2-accounts-endpoints) |
| `PATCH` | `/api/accounts/[id]` | [Accounts](#2-accounts-endpoints) |
| `DELETE` | `/api/accounts/[id]` | [Accounts](#2-accounts-endpoints) |
| `GET` | `/api/transactions` | [Transactions](#3-transactions-endpoints) |
| `POST` | `/api/transactions` | [Transactions](#3-transactions-endpoints) |
| `PATCH` | `/api/transactions/[id]` | [Transactions](#3-transactions-endpoints) |
| `DELETE` | `/api/transactions/[id]` | [Transactions](#3-transactions-endpoints) |
| `GET` | `/api/categories` | [Categories](#4-categories-endpoints) |
| `POST` | `/api/categories` | [Categories](#4-categories-endpoints) |
| `PATCH` | `/api/categories/[id]` | [Categories](#4-categories-endpoints) |
| `DELETE` | `/api/categories/[id]` | [Categories](#4-categories-endpoints) |
| `GET` | `/api/settings/options` | [Settings](#5-settings-endpoints) |
| `GET` | `/api/settings` | [Settings](#5-settings-endpoints) |
| `PATCH` | `/api/settings` | [Settings](#5-settings-endpoints) |
| `GET` | `/api/settings/mobile` | [Settings](#5-settings-endpoints) |
| `PATCH` | `/api/settings/mobile` | [Settings](#5-settings-endpoints) |
| `POST` | `/api/sms` | [SMS](#6-sms-endpoints) |
| `POST` | `/api/sms/bulk` | [SMS](#6-sms-endpoints) |
| `POST` | `/api/sms/preview` | [SMS](#6-sms-endpoints) |
| `GET` | `/api/sms/categories` | [SMS](#6-sms-endpoints) |
| `GET` | `/api/counterparty-messages` | [Counterparty](#7-counterparty-endpoints) |
| `GET` | `/api/counterparty-rules` | [Counterparty](#7-counterparty-endpoints) |
| `POST` | `/api/counterparty-rules` | [Counterparty](#7-counterparty-endpoints) |
| `PATCH` | `/api/counterparty-rules/[id]` | [Counterparty](#7-counterparty-endpoints) |
| `DELETE` | `/api/counterparty-rules/[id]` | [Counterparty](#7-counterparty-endpoints) |
| `GET` | `/api/counterparty-suggestions` | [Counterparty](#7-counterparty-endpoints) |

Prefer `GET` / `PATCH /api/settings/mobile` on mobile (merged shared + mobile fields). Use `GET` / `PATCH /api/settings` only if you need shared settings without mobile fields.

## Auth

Send a valid Clerk token with:

`Authorization: Bearer <clerk_session_token>`

## 1) Summary endpoint

### `GET /api/summary`

Returns current-month, all-time, trend, and expense-by-category aggregates in one request.

#### Query params

- `month` (optional): `YYYY-MM`, defaults to current month.
- `trendMonths` (optional): number of months in trend window (1-24), defaults to `6`.

#### Example request

`GET /api/summary?month=2026-03&trendMonths=6`

#### Response shape

```json
{
  "period": {
    "month": "2026-03",
    "startDate": "2026-03-01",
    "endDateExclusive": "2026-04-01"
  },
  "currentMonth": {
    "income": 3000,
    "expenses": 900,
    "balance": 2100,
    "transactionsCount": 14
  },
  "allTime": {
    "income": 15000,
    "expenses": 8000,
    "balance": 7000,
    "transactionsCount": 120
  },
  "trend": [
    { "month": "2025-10", "income": 2000, "expenses": 1500, "balance": 500 }
  ],
  "expenseByCategory": [
    { "categoryId": "cat_1", "categoryName": "Food", "amount": 300 }
  ]
}
```

#### Status codes

- `200` success
- `400` invalid `month` format
- `401` unauthorized
- `500` server error

## 2) Accounts endpoints

Every transaction belongs to an account. Each user has a default **Wallet** account (created automatically). Account balances are derived from transactions on that account (income adds, expense subtracts; paired transfers move money between accounts).

### Account object

```json
{
  "id": "acc_1",
  "name": "Wallet",
  "isDefault": true,
  "balance": 12500.5
}
```

`balance` is included on `GET /api/accounts` only.

### `GET /api/accounts`

Lists accounts with balances, default first.

#### Status codes

- `200` success
- `401` unauthorized
- `500` server error

### `POST /api/accounts`

#### Request body

- `name` (required): non-empty string. Cannot be `Wallet` (reserved for the default account).

#### Response

Returns the created account with `balance: 0`.

### `PATCH /api/accounts/[id]`

#### Request body

- `name` (required): new name. The default Wallet account cannot be renamed.

### `DELETE /api/accounts/[id]`

Deletes a non-default account. Its transactions are reassigned to Wallet.

The default Wallet account cannot be deleted.

---

## 3) Transactions endpoints

### Transaction object

List responses wrap rows in `transactions`; create/update return a single object with the same fields:

```json
{
  "id": "tx_1",
  "amount": 50,
  "accountId": "acc_1",
  "accountName": "Wallet",
  "categoryId": "cat_1",
  "categoryName": "Food",
  "category": { "id": "cat_1", "name": "Food" },
  "date": "2026-03-15",
  "notes": "Lunch",
  "type": "expense",
  "transferGroupId": null,
  "transferLeg": null,
  "counterAccountId": null,
  "counterAccountName": null,
  "smsCounterparty": null,
  "smsCounterpartyKey": null
}
```

- `accountId` / `accountName`: account this row belongs to.
- `transferGroupId`: shared UUID when two transfer legs form one move (optional).
- `transferLeg`: `out` (money leaves `accountId`) or `in` (money enters `accountId`) for paired transfers.
- `counterAccountId` / `counterAccountName`: the other account in a paired transfer (when present).

Each transaction includes the category **name** in `categoryName` and in `category.name`. Use `categoryId` (or `category.id`) only when you need the UUID. Do not map `categoryId` to a UI field called `category` and expect a label — that value is always an id.

There is no `GET /api/transactions/[id]` for a single row.

### `GET /api/transactions`

Returns the signed-in user's transactions, newest first. Use this for transaction history screens. Aggregates only (counts, totals) live on `GET /api/summary`.

#### Query params

- `limit` (optional): page size, 1–100, default `20`. Passing `limit` or `cursor` enables pagination.
- `cursor` (optional): opaque cursor from a previous response (`date|id`, e.g. `2026-03-15|abc123`).
- `type` (optional): `income`, `expense`, or `transfer`.
- `accountId` (optional): filter to one account.
- `dateFrom` / `dateTo` (optional): `YYYY-MM-DD` inclusive range.
- `search` (optional): case-insensitive match on transaction notes or category name.

#### Example requests

`GET /api/transactions?limit=20`

`GET /api/transactions?limit=20&cursor=2026-03-15|abc123&type=expense&dateFrom=2026-03-01&dateTo=2026-03-31&search=food`

Omit both `limit` and `cursor` to fetch all matching rows in one response (no `nextCursor`). Prefer paginated calls on mobile.

#### Response shape

```json
{
  "transactions": [
    {
      "id": "tx_1",
      "amount": 50,
      "categoryId": "cat_1",
      "categoryName": "Food",
      "category": { "id": "cat_1", "name": "Food" },
      "date": "2026-03-15",
      "notes": "Lunch",
      "type": "expense",
      "transactionCharges": 0,
      "smsCounterparty": null,
      "smsCounterpartyKey": null
    }
  ],
  "nextCursor": "2026-03-15|tx_1",
  "totalIncome": 3000,
  "totalExpense": 900
}
```

`nextCursor` is `null` when there are no more pages. `totalIncome` and `totalExpense` reflect the current filters (including `search`), not only the current page.

#### Pagination flow

1. Request with `limit` (and optional filters).
2. Render `transactions`.
3. If `nextCursor` is non-null, request again with the same filters plus `cursor=<nextCursor>`.
4. Stop when `nextCursor` is `null`.

#### Status codes

- `200` success
- `400` invalid `cursor`
- `401` unauthorized
- `500` server error

### `POST /api/transactions`

Creates a manual transaction for the signed-in user.

#### Request body

- `amount` (required): positive number (magnitude only). Use `type` for income vs expense; negative values are normalized to `ABS(amount)` on the server.
- `categoryId` (required): category UUID owned by the user.
- `date` (required): `YYYY-MM-DD`.
- `type` (required): `income`, `expense`, or `transfer`.
- `accountId` (optional): for `income` / `expense`, defaults to Wallet.
- `fromAccountId` / `toAccountId` (required for `transfer`): creates two linked legs (`transferLeg` `out` / `in`) with the same `transferGroupId`. Must be different accounts.
- `notes` (optional): string, defaults to `""`.
- `transactionCharges` (optional): non-negative number. Fees stored separately from `amount` (e.g. M-PESA transaction cost). Defaults to `0`. Ignored for `transfer` (stored as `0`).
- `idempotencyKey` (optional): string (max 255 chars). When provided, a duplicate request returns the existing transaction instead of inserting again. For SMS saves after `POST /api/sms/preview`, use the preview’s `smsIdempotencyKey` value here (do not generate a new UUID).

#### Example request (expense)

```json
{
  "amount": 50,
  "accountId": "acc_1",
  "categoryId": "cat_1",
  "date": "2026-03-15",
  "type": "expense",
  "notes": "Lunch",
  "transactionCharges": 0
}
```

#### Example request (expense with charges)

```json
{
  "amount": 500,
  "transactionCharges": 7,
  "accountId": "acc_1",
  "categoryId": "cat_1",
  "date": "2026-03-15",
  "type": "expense",
  "notes": "M-PESA payment"
}
```

#### Example request (transfer)

```json
{
  "amount": 200,
  "fromAccountId": "acc_wallet",
  "toAccountId": "acc_savings",
  "categoryId": "cat_transfer",
  "date": "2026-03-15",
  "type": "transfer",
  "notes": "Monthly savings"
}
```

Returns the **out** leg (`transferLeg: "out"`). Fetch the list or filter by `transferGroupId` to show both legs.

#### Response shape

Returns a transaction object (see above) plus create metadata:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `"created"` \| `"duplicate"` | `created` when a new row was inserted; `duplicate` when an existing row was returned (same `idempotencyKey`). |
| `message` | string | Present when `status` is `duplicate`. Same text as the web app: *"Duplicate SMS ignored: this transaction is already saved."* |

#### Example response (new transaction)

```json
{
  "id": "tx_1",
  "amount": 50,
  "categoryId": "cat_1",
  "date": "2026-03-15",
  "notes": "Lunch",
  "type": "expense",
  "transactionCharges": 0,
  "status": "created"
}
```

`totalExpense` on `GET /api/transactions` and summary endpoints include `amount + transactionCharges` for each expense row.

#### Example response (duplicate / idempotent replay)

```json
{
  "id": "tx_existing",
  "amount": 60,
  "categoryId": "cat_1",
  "date": "2026-05-03",
  "notes": "UE3L635OYV Confirmed...",
  "type": "expense",
  "status": "duplicate",
  "message": "Duplicate SMS ignored: this transaction is already saved."
}
```

Show `message` to the user when `status` is `duplicate`; do not treat it as a new transaction in local lists.

#### Status codes

- `200` success (including idempotent replay of an existing row; check `status` field)
- `400` invalid payload
- `401` unauthorized
- `500` server error

### `PATCH /api/transactions/[id]`

Updates an existing transaction. All fields in the body are required (same as create, except `idempotencyKey` is not used).

For rows with a `transferGroupId`, send `fromAccountId` and `toAccountId` to update both legs atomically.

#### Example request

`PATCH /api/transactions/tx_1`

```json
{
  "amount": 55,
  "accountId": "acc_1",
  "categoryId": "cat_1",
  "date": "2026-03-15",
  "type": "expense",
  "notes": "Lunch (updated)",
  "transactionCharges": 0
}
```

`transactionCharges` is optional on update; omit or send `0` to clear charges. Transfers always store `0`.

#### Response shape

Returns the updated transaction object (includes `transactionCharges`).

#### Status codes

- `200` success
- `400` invalid payload
- `401` unauthorized
- `404` transaction not found
- `500` server error

### `DELETE /api/transactions/[id]`

Deletes a transaction owned by the signed-in user. If the row is part of a paired transfer (`transferGroupId` set), both legs are deleted.

#### Example request

`DELETE /api/transactions/tx_1`

#### Response shape

```json
{ "ok": true, "deletedIds": ["tx_1", "tx_2"] }
```

#### Status codes

- `200` success
- `401` unauthorized
- `404` transaction not found
- `500` server error

## 4) Categories endpoints

Use these to populate category pickers when creating or editing transactions (`categoryId` on `POST` / `PATCH /api/transactions`).

### Category object

List responses are a JSON array; create/update return a single object with the same fields:

```json
{
  "id": "cat_1",
  "name": "Food",
  "type": "expense",
  "isDefault": true
}
```

`type` is `income`, `expense`, or `transfer`.

### `GET /api/categories`

Returns the signed-in user's categories, ordered by `type` then `name`.

If the user has no categories yet, the server seeds defaults (Food, Rent, Transport, Bills, Entertainment, Savings, Salary, Other Income, Transfer, Other) and returns them.

#### Example request

`GET /api/categories`

#### Response shape

```json
[
  { "id": "cat_1", "name": "Food", "type": "expense", "isDefault": true },
  { "id": "cat_2", "name": "Salary", "type": "income", "isDefault": true }
]
```

#### Status codes

- `200` success
- `401` unauthorized
- `500` server error

### `POST /api/categories`

Creates a category for the signed-in user.

#### Request body

- `name` (required): string.
- `type` (required): `income`, `expense`, or `transfer`.
- `isDefault` (optional): boolean, defaults to `false`.

#### Example request

```json
{
  "name": "Groceries",
  "type": "expense"
}
```

#### Response shape

Returns a single category object.

#### Status codes

- `200` success
- `400` invalid name or type
- `401` unauthorized
- `500` server error

### `PATCH /api/categories/[id]`

Updates an existing category. Both fields are required.

#### Example request

`PATCH /api/categories/cat_1`

```json
{
  "name": "Food & Dining",
  "type": "expense"
}
```

#### Response shape

Returns the updated category object.

#### Status codes

- `200` success
- `400` invalid name or type
- `401` unauthorized
- `404` category not found
- `500` server error

### `DELETE /api/categories/[id]`

Deletes a category owned by the signed-in user.

If the category has no transactions, send `DELETE` with no body.

If the category has transactions, send a JSON body with one of:

- `reassignToCategoryId`: UUID of another category **of the same type** (not the category being deleted). Transactions are moved to that category, then the category is deleted.
- `deleteTransactions`: `true` — deletes all transactions in that category, then deletes the category.

#### Example requests

`DELETE /api/categories/cat_1`

```json
{ "reassignToCategoryId": "cat_2" }
```

```json
{ "deleteTransactions": true }
```

#### Response shape

```json
{ "ok": true }
```

#### Status codes

- `200` success
- `400` invalid `reassignToCategoryId`
- `401` unauthorized
- `404` category not found
- `409` category has transactions (body omitted or neither option provided); response includes `transactionCount`
- `500` server error

## 5) Settings endpoints

### `GET /api/settings/options`

Returns allowed values for settings fields so mobile can build pickers safely. No auth required.

#### Response shape

```json
{
  "currency": ["USD", "EUR", "GBP", "TZS", "KES", "NGN", "ZAR", "INR"],
  "dateFormat": ["short", "medium", "long"],
  "firstDayOfWeek": ["sunday", "monday"],
  "smsTransactionDateSource": ["message", "received_at"],
  "theme": ["system", "light", "dark"]
}
```

#### Status codes

- `200` success

### `GET /api/settings`

Returns shared (web) settings only: `currency`, `dateFormat`, `firstDayOfWeek`, `smsTransactionDateSource`. Defaults are auto-created if missing.

#### Response shape

```json
{
  "currency": "USD",
  "dateFormat": "medium",
  "firstDayOfWeek": "monday",
  "smsTransactionDateSource": "received_at"
}
```

`smsTransactionDateSource` controls SMS parsing date: `message` uses the date in the SMS body; `received_at` uses the client `timestamp` (or receipt time).

#### Status codes

- `200` success
- `401` unauthorized
- `500` server error

### `PATCH /api/settings`

Partial update of shared settings. Only send fields to change.

#### Request body (all optional)

- `currency`, `dateFormat`, `firstDayOfWeek`, `smsTransactionDateSource` — same allowed values as in `GET /api/settings/options`.

#### Example request

```json
{
  "currency": "KES",
  "smsTransactionDateSource": "message"
}
```

#### Response shape

Returns the updated shared settings object (same shape as `GET`).

#### Status codes

- `200` success
- `400` invalid field value
- `401` unauthorized
- `500` server error

### `GET /api/settings/mobile`

Returns a single merged settings object:

- Shared with web: `currency`, `dateFormat`, `firstDayOfWeek`, `smsTransactionDateSource`
- Mobile-specific: `theme`, `notificationsEnabled`, `biometricsEnabled`

If rows are missing, defaults are auto-created.

#### Response shape

```json
{
  "currency": "USD",
  "dateFormat": "medium",
  "firstDayOfWeek": "monday",
  "smsTransactionDateSource": "received_at",
  "theme": "system",
  "notificationsEnabled": true,
  "biometricsEnabled": false
}
```

### `PATCH /api/settings/mobile`

Partial update is supported; only send fields you want to change. Accepts any field from `GET` (shared + mobile).

#### Example request

```json
{
  "currency": "KES",
  "theme": "dark",
  "notificationsEnabled": false,
  "smsTransactionDateSource": "received_at"
}
```

#### Response shape

Returns the updated merged settings object (same shape as `GET`).

#### Status codes

- `200` success
- `400` invalid payload value
- `401` unauthorized
- `500` server error

### Migration

Before using `/api/settings/mobile`, run:

`psql $DATABASE_URL -f scripts/migrate-user-mobile-settings.sql`

Before using transaction charges (`transactionCharges` on transactions, `charges` in SMS `parsed`), run:

`psql $DATABASE_URL -f scripts/migrate-transaction-charges.sql`

## 6) SMS endpoints

SMS routes parse M-PESA-style messages (`lib/sms-parser.ts`), apply counterparty category rules when present, and create transactions on the default Wallet account with idempotency. Transfer-classified SMS are inserted as single legs; when a matching second leg exists (same date, amount, shared reference in notes), both rows are linked with a shared `transferGroupId` and `transferLeg` `out`/`in`. See also `docs/SMS-API-MOBILE.md` for mobile client integration notes.

### Parsed object (`parsed`)

Returned by `POST /api/sms`, `POST /api/sms/bulk`, and `POST /api/sms/preview`:

```json
{
  "message": "Full SMS body",
  "type": "expense",
  "amount": 500,
  "date": "2026-03-15",
  "charges": 0,
  "transactionRef": "ABC123",
  "counterparty": "John Doe",
  "counterpartyKey": "john-doe",
  "accountReference": null
}
```

`type` may be `income`, `expense`, `transfer`, or `neither`.

### `POST /api/sms`

Ingest one SMS and optionally create a transaction.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | string | Yes | Raw SMS body |
| `timestamp` | number | No | Unix ms; used when date source is `received_at` and SMS has no date |

Parsed `charges` are stored on the created transaction as `transactionCharges` (separate from `amount`).

#### Example request

```json
{
  "message": "You have received KES 500 from John Doe...",
  "timestamp": 1710000000000
}
```

#### Response shape

```json
{
  "status": "created",
  "transactionCreated": true,
  "parsed": { "message": "...", "type": "income", "amount": 500, "date": "2026-03-15", "charges": 0, "transactionRef": null, "counterparty": "John Doe", "counterpartyKey": "john-doe", "accountReference": null },
  "transaction": {
    "id": "tx_1",
    "amount": 500,
    "transactionCharges": 0,
    "categoryId": "cat_1",
    "date": "2026-03-15",
    "notes": "You have received...",
    "type": "income",
    "smsCounterparty": "John Doe",
    "smsCounterpartyKey": "john-doe"
  }
}
```

`status` is one of:

- `created` — new transaction inserted
- `duplicate` — same SMS already processed (`transaction` is the existing row)
- `ignored` — not actionable (`reason` explains why; no `transaction`)

#### Status codes

- `200` success (including `ignored` and `duplicate`)
- `400` invalid body or no category for parsed type
- `401` unauthorized
- `500` server error

### `POST /api/sms/bulk`

Process up to 100 SMS strings in one request.

#### Request body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `messages` | string[] | Yes | Array of raw SMS bodies (max 100) |
| `timestamp` | number | No | Applied to all items when date source is `received_at` |

#### Example request

```json
{
  "messages": ["SMS body 1", "SMS body 2"],
  "timestamp": 1710000000000
}
```

#### Response shape

```json
{
  "summary": { "created": 1, "duplicates": 0, "ignored": 1, "failed": 0 },
  "results": [
    {
      "index": 0,
      "status": "created",
      "transactionCreated": true,
      "parsed": { "message": "...", "type": "expense", "amount": 100, "date": "2026-03-15", "charges": 7, "transactionRef": null, "counterparty": null, "counterpartyKey": null, "accountReference": null },
      "transaction": { "id": "tx_1", "amount": 100, "transactionCharges": 7, "categoryId": "cat_1", "date": "2026-03-15", "notes": "...", "type": "expense", "smsCounterparty": null, "smsCounterpartyKey": null }
    },
    {
      "index": 1,
      "status": "ignored",
      "transactionCreated": false,
      "reason": "Message did not match an income, expense, or transfer transaction",
      "parsed": { "message": "...", "type": "neither", "amount": 0, "date": "", "charges": 0, "transactionRef": null, "counterparty": null, "counterpartyKey": null, "accountReference": null }
    }
  ]
}
```

Per-item `status`: `created`, `duplicate`, `ignored`, or `failed`.

#### Status codes

- `200` success
- `400` invalid payload (not an array, non-strings, or more than 100 messages)
- `401` unauthorized
- `500` server error

### `POST /api/sms/preview`

Parse one SMS and return a proposed transaction without inserting. Use to prefill a form before `POST /api/transactions`. When saving, pass `smsIdempotencyKey` from this response as `idempotencyKey` on `POST /api/transactions` so the row dedupes against `POST /api/sms` and prior saves (same formula as the web “Paste SMS” flow).

#### Request body

Same as `POST /api/sms` (`message`, optional `timestamp`).

#### Response shape

```json
{
  "status": "ready",
  "reason": null,
  "parsed": { "message": "...", "type": "expense", "amount": 50, "date": "2026-03-15", "charges": 7, "transactionRef": null, "counterparty": "Shop", "counterpartyKey": "shop", "accountReference": null },
  "preview": {
    "amount": 50,
    "transactionCharges": 7,
    "categoryId": "cat_1",
    "date": "2026-03-15",
    "notes": "Full SMS body...",
    "type": "expense",
    "smsCounterparty": "Shop",
    "smsCounterpartyKey": "shop"
  },
  "smsIdempotencyKey": "sms|expense|50.00|2026-03-15|ABC123XY"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `smsIdempotencyKey` | string \| null | Present when the message is actionable (`ready` or `needs_category`). Omitted equivalent: `null` when `ignored`. Pass unchanged as `idempotencyKey` on `POST /api/transactions`. Do not hash on the client—the server hashes on insert. |

`status` is `ready` (category resolved), `needs_category` (parsed OK but no category), or `ignored` (`preview` and `smsIdempotencyKey` are `null`).

#### Status codes

- `200` success
- `400` invalid body
- `401` unauthorized
- `500` server error

### `GET /api/sms/categories`

Returns the user's categories (same shape as `GET /api/categories`). Seeds defaults if the user has none. Convenience alias for SMS preview/edit flows.

#### Response shape

JSON array of category objects (see [Categories](#3-categories-endpoints)).

#### Status codes

- `200` success
- `401` unauthorized
- `500` server error

## 7) Counterparty endpoints

Counterparty keys come from SMS parsing (`counterpartyKey` on transactions). Rules map a payee/payer key + transaction type to a category; saving a rule also updates matching existing transactions.

### Counterparty rule object

```json
{
  "id": "rule_1",
  "counterpartyKey": "john-doe",
  "transactionType": "expense",
  "categoryId": "cat_1",
  "categoryName": "Food"
}
```

### `GET /api/counterparty-messages`

Returns up to 5 recent transaction notes (SMS bodies) for a counterparty.

#### Query params

- `counterpartyKey` (required): normalized payee/payer key
- `transactionType` (required): `income` or `expense`

#### Example request

`GET /api/counterparty-messages?counterpartyKey=john-doe&transactionType=expense`

#### Response shape

```json
{
  "messages": [
    { "id": "tx_1", "date": "2026-03-15", "amount": 500, "body": "You have sent KES 500 to John Doe..." }
  ]
}
```

#### Status codes

- `200` success
- `400` missing or invalid params
- `401` unauthorized
- `500` server error

### `GET /api/counterparty-rules`

Lists all saved counterparty → category rules for the user.

#### Response shape

```json
{
  "rules": [
    {
      "id": "rule_1",
      "counterpartyKey": "john-doe",
      "transactionType": "expense",
      "categoryId": "cat_1",
      "categoryName": "Food",
      "transferToAccountId": null,
      "transferToAccountName": null
    }
  ]
}
```

For `transactionType` `transfer`, `transferToAccountId` / `transferToAccountName` reflect the rule destination (omitted DB value resolves to the user’s default Wallet).

#### Status codes

- `200` success
- `401` unauthorized
- `500` server error

### `POST /api/counterparty-rules`

Creates or updates a rule (upsert on `user_id` + `counterpartyKey` + `transactionType`) and reassigns matching transactions.

#### Request body

- `counterpartyKey` (required): string (may include `|account:...` scope suffix)
- `transactionType` (required): `income`, `expense`, or `transfer`
- `categoryId` (required): category UUID; category `type` must match `transactionType`
- `counterpartyLabel` (optional): display label stored on updated transactions
- `transferToAccountId` (optional, transfer rules only): destination account UUID; omit or `null` for default Wallet. When set to a non-Wallet account, matching and new SMS transfers are paired Wallet → this account.

#### Example request

```json
{
  "counterpartyKey": "john-doe",
  "transactionType": "expense",
  "categoryId": "cat_1",
  "counterpartyLabel": "John Doe"
}
```

#### Response shape

```json
{
  "updatedCount": 3,
  "transactions": [ { "id": "tx_1", "amount": 50, "categoryId": "cat_1", "date": "2026-03-15", "notes": "...", "type": "expense", "smsCounterparty": "John Doe", "smsCounterpartyKey": "john-doe" } ]
}
```

#### Status codes

- `200` success
- `400` invalid payload or category mismatch
- `401` unauthorized
- `500` server error

### `PATCH /api/counterparty-rules/[id]`

Updates an existing rule and reassigns matching transactions. Same body as `POST`.

#### Response shape

```json
{ "updatedCount": 2 }
```

#### Status codes

- `200` success
- `400` invalid payload or category mismatch
- `401` unauthorized
- `404` rule not found
- `500` server error

### `DELETE /api/counterparty-rules/[id]`

Deletes a rule. Does not revert transaction categories.

#### Example request

`DELETE /api/counterparty-rules/rule_1`

#### Response shape

```json
{ "ok": true }
```

#### Status codes

- `200` success
- `401` unauthorized
- `404` rule not found
- `500` server error

### `GET /api/counterparty-suggestions`

Suggests counterparties seen often in the last 90 days that do not yet have a rule (≥ 3 occurrences).

#### Response shape

```json
{
  "windowDays": 90,
  "minOccurrences": 3,
  "suggestions": [
    {
      "counterpartyKey": "john-doe",
      "label": "John Doe",
      "transactionType": "expense",
      "count": 5
    }
  ]
}
```

#### Status codes

- `200` success
- `401` unauthorized
- `500` server error

## Related docs

- Mobile SMS client setup: `docs/SMS-API-MOBILE.md`
