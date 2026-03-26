# Mobile API

This document describes the API endpoints the mobile app should use first:

- Summary endpoint for dashboard cards/charts.
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

## 2) Settings options endpoint

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

## 3) Mobile settings endpoint

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
