"""Check what substitutions, carbon and reliability data really allow.

Offline part: attribute safety of the official substitution pairs, carbon variance inside categories, labels.
Online part (2 calls): availability and price of every substitution source and target.
Usage: python3 -I scripts/analysis/subs_carbon.py data
"""
import collections
import csv
import json
import os
import statistics
import sys
import urllib.request


def name(p):
    """Finnish name or the first name."""
    names = p["synkkaData"].get("names") or [{}]
    m = [n for n in names if str(n.get("language", "")).startswith("fi")]
    return (m or names)[0].get("value", "")


def ids_of(p, group, unit=None):
    """Set of classification ids in a group, optionally filtered by unit (CONTAINS / FREE_FROM)."""
    return {v.get("id") for g in p["synkkaData"].get("classifications") or [] if g["name"] == group for v in g["values"] if unit is None or v.get("unit") == unit}


def call(path, body):
    """POST JSON to the mock API and return the parsed reply."""
    req = urllib.request.Request(os.environ.get("VALIO_API_BASE", "https://junction26.valioaimo.fi") + path, data=json.dumps(body).encode(),
                                 headers={"X-API-Key": os.environ["VALIO_API_KEY"], "Content-Type": "application/json", "User-Agent": "junction26-analysis/0.1"}, method="POST")
    return json.load(urllib.request.urlopen(req, timeout=60))


def main():
    """Print substitution, carbon and reliability findings."""
    d = sys.argv[1]
    P = json.load(open(os.path.join(d, "product_data.json"), encoding="utf-8"))
    B = {p["id"]: p for p in P}
    rel = {r[0]: float(r[1]) for r in list(csv.reader(open(os.path.join(d, "delivery_reliability.csv"))))[1:]}
    carb = {r[0]: float(r[1]) for r in list(csv.reader(open(os.path.join(d, "carbon_footprint.csv"))))[1:]}
    pairs = [(p["id"], s["substituteProduct"]) for p in P for s in p.get("substitutions") or []]
    C = collections.Counter
    sym = sum((b, a) in set(pairs) for a, b in pairs)
    lost_lf = [(a, b) for a, b in pairs if "FREE_FROM_LACTOSE" in ids_of(B[a], "nutritionalClaim") and "FREE_FROM_LACTOSE" not in ids_of(B[b], "nutritionalClaim")]
    new_all = [(a, b, sorted(ids_of(B[b], "allergen", "CONTAINS") - ids_of(B[a], "allergen", "CONTAINS"))) for a, b in pairs if ids_of(B[b], "allergen", "CONTAINS") - ids_of(B[a], "allergen", "CONTAINS")]
    lost_gf = sum("FREE_FROM_GLUTEN" in ids_of(B[a], "nutritionalClaim") and "FREE_FROM_GLUTEN" not in ids_of(B[b], "nutritionalClaim") for a, b in pairs)
    lost_org = sum("EU_ORGANIC_FARMING" in ids_of(B[a], "packagingMarkedLabel") and "EU_ORGANIC_FARMING" not in ids_of(B[b], "packagingMarkedLabel") for a, b in pairs)
    print("pairs", len(pairs), "symmetric", sym, "| subs per product", C(len(p.get("substitutions") or []) for p in P if p.get("substitutions")))
    print("diff salesUnit", sum(B[a]["salesUnit"] != B[b]["salesUnit"] for a, b in pairs), "diff temp", sum(B[a].get("temperatureCondition") != B[b].get("temperatureCondition") for a, b in pairs),
          "diff brand", sum(B[a]["synkkaData"].get("brand") != B[b]["synkkaData"].get("brand") for a, b in pairs), "diff vendor", sum(B[a].get("vendorName") != B[b].get("vendorName") for a, b in pairs),
          "diff origin", sum(B[a].get("countryOfOrigin") != B[b].get("countryOfOrigin") for a, b in pairs))
    print("substitute loses lactose-free claim:", len(lost_lf), [(a, name(B[a])[:30], b, name(B[b])[:30]) for a, b in lost_lf][:5])
    print("substitute adds a CONTAINS allergen:", len(new_all), [(a, name(B[a])[:25], b, name(B[b])[:25], x) for a, b, x in new_all][:6])
    print("substitute loses gluten-free claim:", lost_gf, "loses organic label:", lost_org)
    ids = sorted({x for ab in pairs for x in ab})
    body = {"customer": "junction-analysis", "requestedDate": "2026-11-16", "products": ids}
    avail = call("/api/availability", body)
    A = {x["productId"]: x for x in avail["products"]}
    now = avail["timeNow"]
    R = {x["productId"]: x for x in call("/api/price", body)["products"]}

    def state(i):
        """Orderable-in-time state of a product from the availability reply."""
        x = A[i]
        ls = [s for s in x.get("scheduleLines", []) if s["availableAmount"] > 0 and not s.get("salesBlock")]
        if not ls:
            return "unavailable"
        return "open" if x.get("closingTime", "") > now else "closed"

    print("source state x substitute state:", C((state(a), state(b)) for a, b in pairs).most_common())
    src = collections.defaultdict(list)
    for a, b in pairs:
        src[a].append(b)
    print("sources with >=1 open substitute:", sum(any(state(b) == "open" for b in bs) for bs in src.values()), "/", len(src))
    dp = []
    for a, b in pairs:
        ca, cb = (R[a].get("comparisonPrice") or {}).get("value"), (R[b].get("comparisonPrice") or {}).get("value")
        if ca and cb and R[a].get("comparisonUnit") == R[b].get("comparisonUnit"):
            dp.append(cb / ca - 1)
    dp.sort()
    print("substitute comparison-price delta: n", len(dp), "median", round(statistics.median(dp), 3), "p10", round(dp[len(dp) // 10], 3), "p90", round(dp[len(dp) * 9 // 10], 3), "max", round(dp[-1], 2), ">+20%:", sum(x > 0.2 for x in dp))
    print("\n== carbon: distinct values", len(set(carb.values())), "min/median/max", min(carb.values()), statistics.median(carb.values()), max(carb.values()))
    bycat = collections.defaultdict(set)
    for p in P:
        if p["id"] in carb:
            bycat[p["category"]].add(carb[p["id"]])
    print("categories with carbon:", len(bycat), "| categories where all products share ONE value:", sum(len(v) == 1 for v in bycat.values()), "| distinct values per category:", C(min(len(v), 6) for v in bycat.values()).most_common())
    for c in ["10400", "10405", "10500", "18750", "41720", "22300"]:
        print("  cat", c, sorted(bycat.get(c, []))[:8])
    print("\n== reliability: by temperature class (n, mean, share<0.9)")
    bt = collections.defaultdict(list)
    for p in P:
        if p["id"] in rel:
            bt[p.get("temperatureCondition")].append(rel[p["id"]])
    for k in sorted(bt, key=str):
        v = bt[k]
        print("  temp", k, len(v), round(sum(v) / len(v), 3), round(sum(x < 0.9 for x in v) / len(v), 3))
    print("reliability <0.5:", [(i, name(B[i])[:30], rel[i]) for i in rel if rel[i] < 0.5][:8])
    print("\n== labels (packagingMarkedLabel) top:", C(x for p in P for x in ids_of(p, "packagingMarkedLabel")).most_common(25))


if __name__ == "__main__":
    main()
