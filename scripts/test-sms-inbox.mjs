import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: name => name in mocks ? mocks[name] : require(name), Request, Response, Headers, URL, Date, Set, Map, console, Buffer, process });
  return loadedModule.exports;
}
const json = (value, init) => Response.json(value, init);
const id = "11111111-1111-4111-8111-111111111111";
const request = body => new Request("http://localhost/api/sms/inbox", { method: "POST", body: JSON.stringify(body) });
const item = (overrides = {}) => ({ id, sender: "MPESA", message: "SMS", timestamp: Date.now(), status: "pending", previewStatus: "ready", preview: { amount: 100, transactionCharges: 5, type: "expense", date: "2026-11-16", categoryId: "cat" }, ...overrides });
const smsParser = load("lib/sms-parser.ts", { "@/lib/currency-codes": load("lib/currency-codes.ts") });

test("preview respects month, fees, transfers, dismissal and duplicate exclusions", () => {
  const { pendingSmsTotal } = load("lib/pending-sms-total.ts");
  const messages = [item(), item({ preview: { amount: 500, type: "income", date: "2026-11-16" } }), item({ preview: { amount: 900, type: "transfer", date: "2026-11-16" } }), item({ previewStatus: "duplicate" }), item({ status: "dismissed" }), item({ preview: { amount: 1000, type: "expense", date: "2026-10-01" } }), item({ preview: null, previewStatus: "ignored" })];
  const total = pendingSmsTotal(messages, "2026-11", null);
  assert.equal(total.balance, 395);
  assert.equal(total.expenses, 105);
  assert.equal(total.count, 3);
  assert.equal(total.needsReview, 1);
});

test("unauthenticated inbox requests never touch the database", async () => {
  const route = load("app/api/sms/inbox/route.ts", {
    "next/server": { NextResponse: { json } }, "@clerk/nextjs/server": { auth: async () => ({ userId: null }) },
    "@/lib/db": { sql: () => { throw new Error("Unexpected DB access"); } }, "@/lib/text-encryption": {}, "@/lib/sms-inbox": {}, "@/lib/pending-sms-total": {},
  });
  assert.equal((await route.GET(new Request("http://localhost/api/sms/inbox"))).status, 401);
  assert.equal((await route.POST(request({}))).status, 401);
});

test("upload validates every account and message before writing any rows", async () => {
  let writes = 0;
  const route = load("app/api/sms/inbox/route.ts", {
    "next/server": { NextResponse: { json } }, "@clerk/nextjs/server": { auth: async () => ({ userId: "alice" }) },
    "@/lib/db": { sql: async (strings, ...values) => { assert.ok(values.includes("alice")); if (strings.join("").includes("INSERT")) writes++; return [{ id: "own" }]; } },
    "@/lib/text-encryption": {}, "@/lib/sms-inbox": {}, "@/lib/pending-sms-total": {},
  });
  const response = await route.POST(request({ deviceId: "phone", messages: [{ sender: "MPESA", message: "ok", timestamp: Date.now(), accountId: "own" }, { sender: "MPESA", message: "bad", timestamp: Date.now(), accountId: "someone-else" }] }));
  assert.equal(response.status, 400); assert.equal(writes, 0);
});

test("inbox ciphertext is bound to its user and detects tampering", () => {
  const previous = process.env.BAJETI_TEXT_ENCRYPTION_KEY;
  process.env.BAJETI_TEXT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    const { encryptText, decryptText } = load("lib/text-encryption.ts");
    const context = { userId: "alice", field: "sms_message" };
    const encrypted = encryptText("Private SMS", context);
    assert.ok(!encrypted.includes("Private SMS"));
    assert.equal(decryptText(encrypted, context), "Private SMS");
    assert.throws(() => decryptText(encrypted, { ...context, userId: "bob" }));
    assert.throws(() => decryptText(encrypted.replace(/.$/, "!"), context));
  } finally { if (previous == null) delete process.env.BAJETI_TEXT_ENCRYPTION_KEY; else process.env.BAJETI_TEXT_ENCRYPTION_KEY = previous; }
});

function actionRoute(inspect, importer, queries, checkAccounts = () => assert.fail("Unexpected transfer")) {
  return load("app/api/sms/inbox/action/route.ts", {
    "next/server": { NextResponse: { json } }, "@clerk/nextjs/server": { auth: async () => ({ userId: "alice" }) },
    "@/lib/db": { sql: async (strings, ...values) => {
      const query = strings.join("?");
      queries.push({ query, values });
      if (query.includes("SELECT *")) return [{ id, status: "pending" }];
      if (query.includes("SELECT id FROM categories") && values.includes("transfer")) return [{ id: "transfer-cat" }];
      return [];
    } },
    "@/lib/sms-inbox": { inspectInboxMessage: inspect, smsRequest: () => request({}) },
    "@/lib/sms-import-service": { importSms: importer },
    "@/lib/transfers": { assertDistinctAccounts: checkAccounts },
  });
}

test("already-saved SMS is linked without creating another transaction", async () => {
  const queries = [];
  const route = actionRoute(async () => item({ previewStatus: "duplicate", transactionId: "existing" }), () => { throw new Error("Must not import duplicate"); }, queries);
  const result = await (await route.POST(request({ ids: [id], action: "sync" }))).json();
  assert.equal(result.results[0].status, "synced");
  assert.ok(queries.some(q => q.query.includes("UPDATE") && q.values.includes("existing") && q.values.includes("alice")));
});

test("failed imports remain pending and can be retried", async () => {
  const queries = [];
  const route = actionRoute(async () => item(), async () => json({ error: "Network failure" }, { status: 500 }), queries);
  const result = await (await route.POST(request({ ids: [id], action: "sync" }))).json();
  assert.equal(result.results[0].status, "failed");
  assert.equal(queries.filter(q => q.query.includes("UPDATE")).length, 0);
});

test("a reviewed SMS can change type and save notes and both transfer accounts", async () => {
  const queries = [];
  const fromAccountId = "22222222-2222-4222-8222-222222222222";
  const toAccountId = "33333333-3333-4333-8333-333333333333";
  let saved;
  const route = actionRoute(async () => item(), async (_user, _request, edits) => {
    saved = edits;
    return json({ status: "created", transaction: { id: "saved" } });
  }, queries, async (...args) => assert.deepEqual(args, ["alice", null, fromAccountId, toAccountId]));
  const edits = { type: "transfer", amount: 101, transactionCharges: 0, date: "2026-11-17", categoryId: "transfer-cat", notes: "Move funds", fromAccountId, toAccountId };
  const result = await (await route.POST(request({ ids: [id], action: "sync", edits }))).json();
  assert.equal(result.results[0].status, "synced");
  assert.deepEqual({ ...saved }, edits);
  assert.ok(queries.some(q => q.query.includes("UPDATE") && q.values.includes("saved")));
});

test("a dismissal only updates the signed-in user's inbox", async () => {
  const queries = [];
  const route = actionRoute(() => { throw new Error("Dismiss must not parse"); }, () => { throw new Error("Dismiss must not import"); }, queries);
  const result = await (await route.POST(request({ ids: [id], action: "dismiss" }))).json();
  assert.equal(result.results[0].status, "dismissed");
  assert.ok(queries.every(q => q.query.includes("user_id") && q.values.includes("alice")));
});

test("saved and pending balance use one snapshot and exclude the same saved SMS", async () => {
  const snapshotQueries = [];
  const row = { id, sender: "MPESA", message_encrypted: "source", fingerprint: "raw:other", received_at: "2026-11-16T09:00:00Z", status: "pending", account_id: null, transaction_id: null };
  const saved = { id: "saved", sms_idempotency_key: "canonical:key", sms_raw_hash: "raw:saved", date: "2026-11-16", type: "expense", amount_encrypted: "100", transaction_charges: 5 };
  const { inspectPendingMessages } = load("lib/sms-inbox.ts", {
    "./db": { sql: async (strings, ...values) => {
      const query = strings.join("?");
      assert.ok(values.includes("alice"));
      if (query.includes("AS inbox")) { snapshotQueries.push(query); return [{ inbox: [row, { ...row, fingerprint: saved.sms_raw_hash, message_encrypted: "already saved" }], saved: [saved] }]; }
      return [];
    } },
    "./text-encryption": { decryptText: x => x, decryptNumber: x => Number(x), decryptOptionalNumber: (_cipher, plain) => plain, keyedFingerprint: x => `canonical:${x}` },
    "./user-currency": { getUserCurrency: async () => "KES" },
    "./user-sms-settings": { getSmsTransactionDateSource: async () => "received_at" },
    "./bajeti-scope": { ensureDefaultCategoriesForScope: async () => {} },
    "./sms-preview-service": { previewSms: async (_user, request) => {
      assert.equal((await request.json()).message, "source");
      return json({ status: "ready", preview: item().preview, smsIdempotencyKey: "key" });
    } },
    "./sms-parser": smsParser,
  });
  const result = await inspectPendingMessages("alice", "2026-11");
  assert.equal(snapshotQueries.length, 1);
  assert.ok(snapshotQueries[0].includes("sms_inbox") && snapshotQueries[0].includes("FROM transactions"));
  assert.equal(result.savedBalance, -105);
  assert.equal(result.messages.length, 0);
  const { pendingSmsTotal } = load("lib/pending-sms-total.ts");
  assert.equal(result.savedBalance + pendingSmsTotal(result.messages, "2026-11", null).balance, -105);
});

test("the inbox recognizes old transfers and both confirmations for a saved transfer", async () => {
  const bank = "KES 100 sent to M-PESA. MPESA Ref. UF1L66EON5";
  const confirmation = "UF1L66EON5 Confirmed. Ksh100.00 received.";
  const wrongAmount = "UF1L66EON5 Confirmed. Ksh200.00 received.";
  const unrelated = "Ksh100.00 received from 0712345678.";
  const legacy = "Ksh50.00 sent to Savings.";
  const fingerprint = (text, purpose) => `${purpose}:${text}`;
  const rows = [bank, confirmation, wrongAmount, unrelated, legacy].map((message, index) => ({
    ...item(), id: String(index), message_encrypted: message, received_at: "2026-11-16T09:00:00Z",
    fingerprint: fingerprint(message.toLowerCase(), "sms_raw"), transaction_id: null,
  }));
  const transfer = { type: "transfer", date: "2026-11-16", amount_encrypted: "100", transfer_group_id: "pair" };
  const saved = [
    { ...transfer, id: "out", transfer_leg: "out", sms_message: bank },
    { ...transfer, id: "in", transfer_leg: "in" },
    { ...transfer, id: "legacy", transfer_group_id: null, sms_message: legacy },
  ];
  const { inspectPendingMessages, inspectInboxStates, inspectInboxMessage } = load("lib/sms-inbox.ts", {
    "./db": { sql: async (strings, ...values) => {
      const query = strings.join("?");
      assert.ok(values.includes("alice"));
      if (query.includes("AS inbox")) {
        assert.ok(query.includes("group_id IS NULL"));
        return [{ inbox: rows, saved }];
      }
      if (query.includes("AND type = 'transfer'")) return saved;
      return [];
    } },
    "./text-encryption": { decryptText: x => x, decryptNumber: Number, keyedFingerprint: fingerprint },
    "./user-currency": { getUserCurrency: async () => "KES" },
    "./user-sms-settings": { getSmsTransactionDateSource: async () => "received_at" },
    "./bajeti-scope": { ensureDefaultCategoriesForScope: async () => {} },
    "./sms-parser": smsParser,
    "./sms-preview-service": { previewSms: async () => json({ status: "ready", preview: { ...item().preview, type: "transfer" } }) },
  });
  const result = await inspectPendingMessages("alice", "2026-11");
  assert.deepEqual(Array.from(result.messages, message => message.id), ["2", "3"]);
  const { pendingSmsTotal } = load("lib/pending-sms-total.ts");
  assert.equal(pendingSmsTotal(result.messages, "2026-11", null).count, 2);
  const states = await inspectInboxStates("alice");
  assert.deepEqual(Array.from(states, state => state.status), ["synced", "synced", "pending", "pending", "synced"]);
  const duplicate = await inspectInboxMessage("alice", rows[1]);
  assert.equal(duplicate.previewStatus, "duplicate");
  assert.equal(duplicate.transactionId, "out");
});

test("direct SMS saves use the same canonical key as automatic imports, with legacy lookup", async () => {
  const key = "sms|expense|100.00|KES|2026-11-16|ABC";
  let candidates;
  const noop = () => {};
  const route = load("app/api/transactions/route.ts", {
    "next/server": { NextResponse: { json } }, "@clerk/nextjs/server": { auth: async () => ({ userId: "alice" }) },
    "@/lib/db": { sql: async (_strings, ...values) => { candidates = values.find(v => typeof v === "string" && v.startsWith("[")); return [{ id: "already-saved" }]; } },
    "@/lib/transaction-api": { transactionCreateResponse: (row, status) => ({ id: row.id, status }) },
    "@/lib/group-member-profiles": {}, "@/lib/transaction-amount": {},
    "@/lib/bajeti-scope": { requireBajetiPermission: async () => ({ groupId: null }) },
    "@/lib/accounts": {}, "@/lib/transfers": {},
    "@/lib/transaction-attachments": { parseAttachmentInputs: noop },
    "@/lib/text-encryption": { keyedFingerprint: (input, purpose) => `${purpose}:${input}` },
  });
  const result = await (await route.POST(request({ amount: 100, date: "2026-11-16", categoryId: "cat", type: "expense", idempotencyKey: key, smsMessage: "source" }))).json();
  assert.equal(result.status, "duplicate");
  const keys = JSON.parse(candidates);
  assert.ok(keys.includes(`sms_idempotency:${key}`));
  assert.ok(keys.some(k => /^[a-f0-9]{64}$/.test(k)), "Legacy SHA-256 keys remain readable");
});
