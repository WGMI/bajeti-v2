# Transfers — Mobile App Guide

How to move money between accounts in Bajeti from the mobile client. For full API reference (auth, accounts, pagination), see `docs/MOBILE-API.md`.

## What a transfer is

A transfer moves the same amount from one account to another. The server stores **two linked rows** (legs) with the same `transferGroupId`:

| Leg | `transferLeg` | Effect on `accountId` |
|-----|---------------|------------------------|
| Money leaves source | `out` | Balance decreases |
| Money enters destination | `in` | Balance increases |

Each leg is a normal transaction row with `type: "transfer"`. Use `counterAccountId` / `counterAccountName` on a leg to show the other account in the UI.

Transfers do **not** count as income or expense in summary totals. They only rebalance accounts (e.g. Wallet → Savings).

## Auth

Same as other mobile routes:

```http
Authorization: Bearer <clerk_session_token>
```

## Prerequisites

1. **Accounts** — `GET /api/accounts` returns every account with `balance`. Every user has a default **Wallet** (`isDefault: true`). Create more with `POST /api/accounts` if the app supports named accounts.

2. **Transfer category** — Use a category with `type: "transfer"` (default name **Transfer** is seeded on first `GET /api/categories`). Pass its `id` as `categoryId` when creating or editing a transfer.

## Manual transfer (recommended flow)

### 1. Create

`POST /api/transactions`

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

| Field | Required | Notes |
|-------|----------|--------|
| `amount` | Yes | Positive number (magnitude only). |
| `type` | Yes | Must be `"transfer"`. |
| `fromAccountId` / `toAccountId` | Yes | Different accounts; both must belong to the user. |
| `categoryId` | Yes | Category with `type: "transfer"`. |
| `date` | Yes | `YYYY-MM-DD`. |
| `notes` | No | Defaults to `""`. |
| `transactionCharges` | No | Ignored for transfers (always stored as `0`). |

**Response:** the **out** leg only (`transferLeg: "out"`). Refresh balances via `GET /api/accounts` or load both legs from the transaction list.

### 2. List and filter

`GET /api/transactions?type=transfer&limit=20`

Optional: `accountId`, `dateFrom`, `dateTo`, `search`, `cursor` (same pagination as other types).

**Showing one move in the UI:** rows that share a `transferGroupId` are one transfer. You can:

- Show each leg as its own line (Wallet −200 / Savings +200), or
- Collapse by `transferGroupId` and display “Wallet → Savings, 200”.

### 3. Edit

`PATCH /api/transactions/{id}` on either leg.

Send the full body (same fields as create). For paired transfers, include **`fromAccountId` and `toAccountId`** so both legs update together:

```json
{
  "amount": 250,
  "fromAccountId": "acc_wallet",
  "toAccountId": "acc_savings",
  "categoryId": "cat_transfer",
  "date": "2026-03-15",
  "type": "transfer",
  "notes": "Updated amount"
}
```

### 4. Delete

`DELETE /api/transactions/{id}`

If the row has a `transferGroupId`, **both legs are deleted**. Response includes all removed ids:

```json
{ "ok": true, "deletedIds": ["tx_out", "tx_in"] }
```

## Example transaction row (transfer leg)

```json
{
  "id": "tx_out",
  "amount": 200,
  "accountId": "acc_wallet",
  "accountName": "Wallet",
  "categoryId": "cat_transfer",
  "categoryName": "Transfer",
  "date": "2026-03-15",
  "notes": "Monthly savings",
  "type": "transfer",
  "transferGroupId": "grp_abc",
  "transferLeg": "out",
  "counterAccountId": "acc_savings",
  "counterAccountName": "Savings",
  "transactionCharges": 0
}
```

## SMS transfers (automatic)

M-PESA-style SMS can be parsed as `type: "transfer"` via `POST /api/sms` (see `docs/SMS-API-MOBILE.md`).

Typical behavior:

- First SMS often creates a **single** leg on Wallet.
- When a second matching leg exists (same date, amount, shared reference in notes), the server links both with `transferGroupId` and `transferLeg` `out` / `in`.
- **Counterparty rules** for `transactionType: "transfer"` can set `transferToAccountId` so new and matching SMS transfers are paired as **Wallet → destination account** (omit or `null` = Wallet only).

Example rule:

```json
POST /api/counterparty-rules
{
  "counterpartyKey": "my-savings-bank",
  "transactionType": "transfer",
  "categoryId": "cat_transfer",
  "transferToAccountId": "acc_savings",
  "counterpartyLabel": "My Savings"
}
```

List rules: `GET /api/counterparty-rules` — transfer rules expose `transferToAccountId` / `transferToAccountName`.

## Quick checklist for the mobile UI

| Screen | API |
|--------|-----|
| Pick source / destination | `GET /api/accounts` |
| Pick category | `GET /api/categories` (filter `type === "transfer"`) |
| New manual transfer | `POST /api/transactions` with `fromAccountId`, `toAccountId` |
| History | `GET /api/transactions?type=transfer` |
| Edit / delete | `PATCH` / `DELETE /api/transactions/{id}` (paired rows stay in sync) |

## Errors to handle

| Code | Typical cause |
|------|----------------|
| `400` | Same account for from/to, invalid account id, wrong category type, invalid amount |
| `401` | Missing or expired Clerk token |
| `404` | Transaction id not found (edit/delete) |

## Related docs

- Full mobile API: `docs/MOBILE-API.md` (transactions §3, counterparty §7, SMS §6)
- SMS ingestion: `docs/SMS-API-MOBILE.md`
