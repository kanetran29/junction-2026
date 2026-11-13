"""Check how well 'catalogPrice / comparisonPrice' recovers litres or kg per sales unit.

Compares the price ratio from saved probe replies against Synkka content (volume or net weight of the base unit
times base units per sales unit) and reports agreement. Usage: python3 -I scripts/analysis/conversion_check.py data OUT_DIR
"""
import glob
import json
import os
import sys

TO_L = {"LTR": 1, "MLT": 0.001, "CLT": 0.01, "DLT": 0.1}
TO_KG = {"KGM": 1, "GRM": 0.001}


def synkka_content(p, want):
    """Litres ('L') or kg ('KG') in one sales unit from Synkka base-unit data, or None."""
    per_sales = {u["unitId"]: u["sizeInBaseUnits"] for u in p["units"]}.get(p["salesUnit"])
    for u in p["synkkaData"].get("unitConversions") or []:
        if u.get("synkkaPackagingType") != "BASE_UNIT_OR_EACH":
            continue
        m = u.get("volume") if want == "L" else u.get("netWeight")
        table = TO_L if want == "L" else TO_KG
        if m and m.get("unit") in table and per_sales:
            return m["value"] * table[m["unit"]] * per_sales
    return None


def main():
    """Print agreement statistics per probe file."""
    P = {p["id"]: p for p in json.load(open(os.path.join(sys.argv[1], "product_data.json"), encoding="utf-8"))}
    tot = {"n": 0, "no_cmp": 0, "no_synkka": 0, "agree2": 0, "off": []}
    for f in sorted(glob.glob(os.path.join(sys.argv[2], "*_2026-11-16.json"))):
        for r in json.load(open(f))["price"]["products"]:
            p = P.get(r["productId"])
            if not p:
                continue
            tot["n"] += 1
            cat, cmp_ = (r.get("catalogPrice") or {}).get("value"), (r.get("comparisonPrice") or {}).get("value")
            if not cat or not cmp_ or r.get("comparisonUnit") not in ("L", "KG"):
                tot["no_cmp"] += 1
                continue
            s = synkka_content(p, r["comparisonUnit"])
            if s is None:
                tot["no_synkka"] += 1
                continue
            ratio = cat / cmp_
            if abs(ratio / s - 1) <= 0.02:
                tot["agree2"] += 1
            else:
                tot["off"].append((r["productId"], p["salesUnit"], round(ratio, 3), round(s, 3), r["comparisonUnit"]))
    print({k: (v if k != "off" else len(v)) for k, v in tot.items()})
    print("disagreements (id, salesUnit, price ratio, synkka content, unit):", tot["off"][:25])


if __name__ == "__main__":
    main()
