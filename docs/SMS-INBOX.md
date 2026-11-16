# Shared SMS inbox

## Rollout

1. Run `npm run migrate:sms-inbox` using the target database configuration, before deploying the API. The migration is additive and repeatable.
2. Deploy the web/API changes with the existing `BAJETI_TEXT_ENCRYPTION_KEY`.
3. Build/install the updated Android app. Open it signed in, grant SMS read permission, and choose watched senders. Older mobile versions continue to use the existing import APIs.
4. Visit `/dashboard/messages` in the personal workspace. Uploading does not create transactions. Syncing does.

No production migration or deployment is performed by the source changes themselves.

## Phone behavior

- Uploads run on app entry, SMS permission/sender changes, and observed SMS-provider changes while the process is alive. A network-constrained 15-minute WorkManager job also runs independently of widgets. Android may defer background work; this is eventual delivery rather than a guaranteed instant push.
- Upload cursors and local-to-inbox mappings are scoped to the signed-in user and sender, separate from import cursors. Initial upload skips already-imported and locally-dismissed messages. Retry after partial failure is safe.
- Each uploaded SMS carries its own received timestamp and sender-linked personal account. Device-local SMS IDs are acknowledged to the phone but are not used as the shared duplicate identity.
- Server sync/dismiss statuses suppress the matching local pending message. Local dismissals propagate back to the server. Successfully saved individual SMS are excluded through the existing dismissal/idempotency path.
- Phone bulk imports now accept individual message timestamps; failed batches retain their cursor for retry.

## Endpoints

All endpoints require the existing authenticated user session or bearer token. Inbox data is personal and does not inherit a selected group.

### `POST /api/sms/inbox`

```json
{
  "deviceId": "installation-uuid",
  "messages": [
    { "localId": 123, "sender": "MPESA", "message": "SMS body", "timestamp": 1794823200000, "accountId": null }
  ]
}
```

Accepts up to 100 messages. Returns `{ ok, accepted, receipts: [{ localId, id, status }] }`. An empty batch records a phone heartbeat. Account IDs must belong to the user's personal workspace. Uploads deduplicate on a keyed fingerprint of normalized SMS text, independent of device and local message ID. Existing dismissed/synced rows are not reopened by retries.

### `GET /api/sms/inbox?month=YYYY-MM&summary=1`

Returns `{ messages, summary }`. Omit `summary=1` to include pending message bodies and parsed previews. The summary includes `savedBalance`, pending `income`, `expenses`, `balance`, `count`, `needsReview`, and `lastUploadedAt`.

Saved and pending rows are read in one database statement so concurrent imports cannot appear in both sides of a preview. Totals follow the existing monthly summary: expense fees count as outflow and transfers do not change net income/expense totals. Already-saved transactions, duplicate pending SMS, dismissed rows, and unparseable messages do not contribute. A review count indicates omissions. Rules and settings are read afresh on every request.

### `POST /api/sms/inbox/action`

```json
{ "ids": ["inbox-uuid"], "action": "sync" }
```

Actions are `sync` or `dismiss`, up to 100 IDs. Single-message sync optionally accepts `edits: { amount, transactionCharges, date, categoryId }`. The source message and its duplicate identity are retained even when the proposed amount/date/category is edited. Returns per-message `{ id, status, error? }` results. A failed import remains pending. A successful transaction insert followed by a failed inbox update is recovered by duplicate detection on retry.

### `GET /api/sms/inbox/state`

Returns `{ messages: [{ id, status }] }` without SMS bodies for phone reconciliation. Existing raw-message transaction hashes also identify messages saved through the legacy bulk path.

## Rules

SMS, voice and direct-entry previews open the shared rule editor without replacing their transaction draft. SMS prepopulates the counterparty when available. Voice/direct users enter the payee/payer to match in future SMS. Rules retain the existing behavior of updating matching past transactions; this is stated in the editor.

## Verification

- Web: `npm run test:sms-inbox`, `npx tsc --noEmit`, `npm run build`.
- Android: `gradlew.bat :app:compileDebugKotlin :app:testDebugUnitTest` with a compatible JDK.
- On a test account after migration: upload from two devices, retry an upload, sync concurrently from phone/web, dismiss on either device, change a rule, and verify fee/transfer/month-boundary totals. Check that the web remains usable with the phone offline after upload. Background receipt and widget layout need device verification.
