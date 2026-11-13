"""Probe the Valio Aimo mock APIs for several realistic buyer requests and dates.

Selects candidates by category code (plus an optional lactose-free claim filter), calls availability and price
once per date, and prints an aggregate per date plus one line per product for the first date.
Reads VALIO_API_KEY / VALIO_API_BASE from the environment. Raw replies go to the out dir (never commit them).

Usage: python3 -I scripts/analysis/probe_requests.py data OUT_DIR label cat1,cat2 [lf] date1 date2 ...
"""
import collections
import csv
import json
import os
import sys
import urllib.error
import urllib.request

SENTINEL_FLOOR = 99999.0


def name(p):
    """Finnish name or the first name."""
    names = p["synkkaData"].get("names") or [{}]
    m = [n for n in names if str(n.get("language", "")).startswith("fi")]
    return (m or names)[0].get("value", "")


def has_lf_claim(p):
    """True when the product carries the FREE_FROM_LACTOSE nutritional claim."""
    return any(v.get("id") == "FREE_FROM_LACTOSE" for g in p["synkkaData"].get("classifications") or [] if g["name"] == "nutritionalClaim" for v in g["values"])


def call(path, body):
    """POST JSON to the mock API; return (status, parsed body)."""
    req = urllib.request.Request(
        os.environ.get("VALIO_API_BASE", "https://junction26.valioaimo.fi") + path,
        data=json.dumps(body).encode(),
        headers={"X-API-Key": os.environ["VALIO_API_KEY"], "Content-Type": "application/json", "User-Agent": "junction26-analysis/0.1"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


def amount_class(a):
    """Classify an availableAmount as zero, real stock, or an 'unlimited' sentinel."""
    if a <= 0:
        return "zero"
    return "sentinel" if a >= SENTINEL_FLOOR else "real"


def main():
    """Run the probe and print the tables."""
    d, out, label, cats = sys.argv[1], sys.argv[2], sys.argv[3], set(sys.argv[4].split(","))
    rest = sys.argv[5:]
    lf = rest and rest[0] == "lf"
    dates = rest[1:] if lf else rest
    P = json.load(open(os.path.join(d, "product_data.json"), encoding="utf-8"))
    rel = {r[0]: r[1] for r in list(csv.reader(open(os.path.join(d, "delivery_reliability.csv"))))[1:]}
    carb = {r[0]: r[1] for r in list(csv.reader(open(os.path.join(d, "carbon_footprint.csv"))))[1:]}
    cands = [p for p in P if p["category"] in cats and (not lf or has_lf_claim(p))]
    byid = {p["id"]: p for p in cands}
    ids = sorted(byid)
    print(f"# {label}: {len(ids)} candidates in {sorted(cats)} lf={bool(lf)}; reliability known {sum(i in rel for i in ids)}, carbon known {sum(i in carb for i in ids)}, "
          f"with substitutes {sum(bool(byid[i].get('substitutions')) for i in ids)}")
    for n, date in enumerate(dates):
        body = {"customer": "junction-analysis", "requestedDate": date, "products": ids}
        sa, av = call("/api/availability", body)
        sp, pr = call("/api/price", body)
        json.dump({"availability": av, "price": pr}, open(os.path.join(out, f"{label}_{date}.json"), "w"))
        if sa != 200 or sp != 200:
            print(f"## {date}: availability {sa} price {sp} :: {str(av)[:200]} :: {str(pr)[:200]}")
            continue
        A = {x["productId"]: x for x in av["products"]}
        R = {x["productId"]: x for x in pr["products"]}
        C = collections.Counter
        close = C((x.get("logisticModel"), x.get("closingTime")) for x in A.values())
        lines = [(i, s) for i, x in A.items() for s in x.get("scheduleLines", [])]
        print(f"## {date} timeNow {av.get('timeNow')} returned {len(A)}/{len(ids)} avail, {len(R)}/{len(ids)} price")
        print("   (logisticModel, closingTime):", sorted(close.items(), key=lambda kv: -kv[1]))
        print("   amount classes:", C(amount_class(s["availableAmount"]) for _, s in lines), "| lines per product:", C(len(x.get("scheduleLines", [])) for x in A.values()),
              "| availableDate != requested:", sum(str(s.get("availableDate"))[:10] != date for _, s in lines), "| salesBlock product/line:", sum(bool(x.get("salesBlock")) for x in A.values()), sum(bool(s.get("salesBlock")) for _, s in lines))
        print("   sentinel values:", C(s["availableAmount"] for _, s in lines if amount_class(s["availableAmount"]) == "sentinel").most_common(6))
        print("   line salesUnit != product salesUnit:", sum(s.get("salesUnit") != byid[i]["salesUnit"] for i, s in lines))
        print("   price: error", sum(bool(x.get("error")) for x in R.values()), "netPriceFound false", sum(not x.get("netPriceFound") for x in R.values()), "no catalogPrice", sum(not x.get("catalogPrice") for x in R.values()),
              "cmp units", C(x.get("comparisonUnit") for x in R.values()), "validTo", C(str((x.get("catalogPrice") or {}).get("validTo"))[:10] for x in R.values()).most_common(4))
        if n:
            continue
        for i in ids:
            p, a, r = byid[i], A.get(i, {}), R.get(i, {})
            ls = a.get("scheduleLines", [])
            amt = ";".join(f"{s['availableAmount']:g}@{str(s.get('availableDate'))[5:10]}{'!B' if s.get('salesBlock') else ''}" for s in ls) or "-"
            cat, cmp_ = (r.get("catalogPrice") or {}).get("value"), (r.get("comparisonPrice") or {}).get("value")
            per = round(cat / cmp_, 3) if cat and cmp_ else None
            print(f"{i} | {name(p)[:44]:44} | {p['salesUnit']} lot {p['allowedLotSize']} t{p.get('temperatureCondition')} | {a.get('logisticModel')} close {str(a.get('closingTime'))[5:16]} | {amt} | "
                  f"{cat}€/{p['salesUnit']} cmp {cmp_}€/{r.get('comparisonUnit')} => {per} {r.get('comparisonUnit')}/{p['salesUnit']} | net {r.get('netPriceFound')} err {r.get('error')} | rel {rel.get(i, 'n/a')} co2 {carb.get(i, 'n/a')} | subs {[s['substituteProduct'] for s in p.get('substitutions') or []]}")


if __name__ == "__main__":
    main()
