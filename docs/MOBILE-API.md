# Mobile API

This document describes the API endpoints the mobile app should use first:

- Summary endpoint for dashboard cards/charts.
- Transactions list endpoint for history screens.
- Settings endpoints (shared web settings + mobile-specific settings).
- SMS endpoints (linked at the end).

All endpoints require Clerk authentication.

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

## 2) Transactions list endpoint

### `GET /api/transactions`

Returns the signed-in user's transactions, newest first. Use this for transaction history screens. Aggregates only (counts, totals) live on `GET /api/summary`; there is no `GET /api/transactions/[id]` for a single row.

#### Query params

- `limit` (optional): page size, 1–100, default `20`. Passing `limit` or `cursor` enables pagination.
- `cursor` (optional): opaque cursor from a previous response (`date|id`, e.g. `2026-03-15|abc123`).
- `type` (optional): `income`, `expense`, or `transfer`.
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
      "date": "2026-03-15",
      "notes": "Lunch",
      "type": "expense",
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

## 3) Settings options endpoint

### `GET /api/settings/options`

Returns allowed values for settings fields so mobile can build pickers safely.

#### Response shape

```json
{
  "currency": ["USD", "EUR", "GBP", "TZS", "KES", "NGN", "ZAR", "INR"],
  "dateFormat": ["short", "medium", "long"],
  "firstDayOfWeek": ["sunday", "monday"],
  "theme": ["system", "light", "dark"]
}
```

## 4) Mobile settings endpoint

### `GET /api/settings/mobile`

Returns a single merged settings object:

- Shared with web: `currency`, `dateFormat`, `firstDayOfWeek`
- Mobile-specific: `theme`, `notificationsEnabled`, `biometricsEnabled`

If rows are missing, defaults are auto-created.

#### Response shape

```json
{
  "currency": "USD",
  "dateFormat": "medium",
  "firstDayOfWeek": "monday",
  "theme": "system",
  "notificationsEnabled": true,
  "biometricsEnabled": false
}
```

### `PATCH /api/settings/mobile`

Partial update is supported; only send fields you want to change.

#### Example request

```json
{
  "currency": "KES",
  "theme": "dark",
  "notificationsEnabled": false
}
```

#### Status codes

- `200` success
- `400` invalid payload value
- `401` unauthorized
- `500` server error

## Migration required

Before using `/api/settings/mobile`, run:

`psql $DATABASE_URL -f scripts/migrate-user-mobile-settings.sql`

## Related docs

- SMS single + idempotent creation: `docs/SMS-API-MOBILE.md`
- SMS bulk import: `POST /api/sms/bulk`
- Counterparty SMS bodies: `GET /api/counterparty-messages?counterpartyKey=...&transactionType=income|expense`
- Update/delete a transaction: `PATCH` / `DELETE` on `/api/transactions/[id]` (no read-by-id)
