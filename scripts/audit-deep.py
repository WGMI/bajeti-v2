import pandas as pd
import re
from collections import Counter, defaultdict

rules = pd.read_excel(r"c:/Users/Imo/Downloads/counterparty_category_rules.xlsx")
tx = pd.read_excel(
    r"c:/Users/Imo/Downloads/blue-shadow-45160604_production_neondb_2026-05-30_12-56-58.xlsx"
)

CAT_NAMES = {
    "96ce1d6a-3515-4f81-828a-6b365b4c52b9": "Bills (user)",
    "9d359f52-8cbe-4eef-ba27-7c89914c1dc4": "Groceries (user)",
    "18f36dd3-75c4-4ef0-b332-e85500aa229e": "Transfer (user)",
    "a1000000-1000-4000-8000-000000000001": "Food",
    "a1000000-1000-4000-8000-000000000002": "Rent",
    "a1000000-1000-4000-8000-000000000005": "Entertainment",
    "a1000000-1000-4000-8000-000000000008": "Other Income",
    "505b6163-35a7-44b9-abcf-588b50e9c54f": "Custom expense",
    "63b64e0c-f56c-4427-a5cf-187b452956ea": "Family savings?",
    "cc9bec82-a955-42f6-9630-3b13422422bf": "Rose category",
    "676eae7e-1c2a-4c04-bdc1-e29f1b15d5a8": "Airtime/data",
    "6a5de5af-6820-487d-a621-8ed52b6eff1c": "Internet",
    "61b4a6bd-a841-411a-b90d-4581aeaa97b3": "Person",
    "b13c421f-f141-49bb-be86-a4fd2f8d89c2": "Co-op bank",
}


def cat_name(cid):
    return CAT_NAMES.get(str(cid), str(cid)[:8])


def candidate_keys(ck, notes):
    if not ck or (isinstance(ck, float) and pd.isna(ck)):
        return []
    keys = [str(ck)]
    m = re.search(r"for\s+(?:account|acc)\s+([a-z0-9-]{3,})", str(notes or ""), re.I)
    if m:
        acc = m.group(1).lower().replace(" ", "")
        keys = [f"{keys[0]}|account:{acc}"] + keys
    return keys


mis = []
ruled_ok = 0
no_rule = []
for _, t in tx.iterrows():
    ck = t.get("sms_counterparty_key")
    keys = candidate_keys(ck, t.notes)
    matching = rules[
        (rules.counterparty_key.isin(keys)) & (rules.transaction_type == t.type)
    ]
    if len(matching):
        exp = matching.iloc[0].category_id
        if exp != t.category_id:
            mis.append(
                {
                    "amount": t.amount,
                    "key": ck,
                    "type": t.type,
                    "expected": cat_name(exp),
                    "actual": cat_name(t.category_id),
                }
            )
        else:
            ruled_ok += 1
    else:
        no_rule.append(
            {
                "key": ck or "(empty)",
                "type": t.type,
                "amount": t.amount,
                "cat": cat_name(t.category_id),
                "notes": str(t.notes)[:75],
            }
        )

print("=== Rule application ===")
print(f"Matched rules correctly: {ruled_ok}")
print(f"Wrong category despite rule: {len(mis)}")
for m in mis:
    print(" ", m)

print(f"\nNo matching rule: {len(no_rule)}")
by_key = Counter(x["key"] for x in no_rule)
print("Top unruled keys:")
for k, n in by_key.most_common(20):
    print(f"  {n}x {k}")

# Quick Mart: rule exists - verify all got groceries
qm = tx[tx["sms_counterparty_key"].astype(str).str.contains("quick mart", case=False, na=False)]
print(f"\n=== Quick Mart transactions: {len(qm)} ===")
print(qm.groupby("category_id").size().to_dict())
for _, r in qm.head(3).iterrows():
    print(f"  {r.amount} -> {cat_name(r.category_id)}")

# Potential double-count: QUICK MART on same day from card + mpesa
tx["day"] = pd.to_datetime(tx["date"]).dt.date
exp = tx[tx.type == "expense"].copy()
dup_days = []
for day, g in exp.groupby("day"):
    merchants = defaultdict(list)
    for _, r in g.iterrows():
        cp = str(r.get("sms_counterparty_key") or "").lower()
        if "quick mart" in cp or "quick mart" in str(r.notes).lower():
            merchants["quick mart"].append(r)
    if len(merchants.get("quick mart", [])) >= 2:
        items = merchants["quick mart"]
        if len(items) >= 2:
            dup_days.append(
                {
                    "day": str(day),
                    "count": len(items),
                    "amounts": [float(x.amount) for x in items],
                    "sources": [str(x.notes)[:50] for x in items],
                }
            )

print(f"\n=== Days with 2+ Quick Mart expenses: {len(dup_days)} ===")
for d in dup_days[:10]:
    print(d)

# Ignored SMS from file
ignored_patterns = [
    "Invalid input",
    "Insufficient funds",
    "Fuliza M-PESA amount is",
    "EUR 10.00",
    "USD 23.20",
    "USD 20.00",
    "Payment of KES.",
]
with open(r"c:/Users/Imo/Downloads/sms20260530.txt", encoding="utf-8") as f:
    text = f.read()
print("\n=== SMS in file NOT in DB (manual check) ===")
for pat in ignored_patterns:
    if pat in text:
        print(f"  contains: {pat}")

# Transfer legs
tr = tx[tx.type == "transfer"]
print(f"\n=== Transfers ({len(tr)}) ===")
print(tr[["amount", "date", "sms_counterparty_key", "transfer_leg", "transfer_group_id"]].to_string())

# Fuliza orphan
ful = tx[tx.notes.astype(str).str.contains("Fuliza", case=False, na=False)]
print(f"\n=== Fuliza-related DB rows: {len(ful)} ===")
for _, r in ful.iterrows():
    print(f"  {r.amount} {r.type} cp={r.sms_counterparty_key} cat={cat_name(r.category_id)}")
