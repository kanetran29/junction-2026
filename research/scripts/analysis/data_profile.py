"""Profile product_data.json: categories, units, lot sizes, temperature, coverage of reliability/carbon/substitutions.

Prints aggregates only (never whole records). Usage: python3 -I scripts/analysis/data_profile.py data
"""
import collections
import csv
import json
import os
import sys


def fi_name(p):
    """Finnish product name, falling back to the first name given."""
    names = p.get("synkkaData", {}).get("names") or [{}]
    fi = [n for n in names if str(n.get("language", "")).startswith("fi")]
    return (fi or names)[0].get("value", "")


def main():
    """Load the data once and print the profile tables."""
    d = sys.argv[1]
    P = json.load(open(os.path.join(d, "product_data.json"), encoding="utf-8"))
    rel = {r[0]: float(r[1]) for r in list(csv.reader(open(os.path.join(d, "delivery_reliability.csv"))))[1:]}
    carb_rows = list(csv.reader(open(os.path.join(d, "carbon_footprint.csv"))))
    print("carbon header", carb_rows[0], carb_rows[1:3])
    print("rel header", list(csv.reader(open(os.path.join(d, "delivery_reliability.csv"))))[:3])
    carb = {r[0]: r[1:] for r in carb_rows[1:]}
    C = collections.Counter
    cat = C(p["category"] for p in P)
    print("n", len(P), "categories", len(cat), "code lengths", C(len(c) for c in cat))
    print("top cats", cat.most_common(15))
    print("salesUnit", C(p["salesUnit"] for p in P).most_common(15))
    print("baseUnit", C(p["baseUnit"] for p in P).most_common(15))
    print("salesUnit==baseUnit", sum(p["salesUnit"] == p["baseUnit"] for p in P))
    print("lot", C(p.get("allowedLotSize") for p in P).most_common(10))
    print("temp", C(p.get("temperatureCondition") for p in P).most_common())
    print("origin", C(p.get("countryOfOrigin") for p in P).most_common(10))
    print("vendor top", C(p.get("vendorName") for p in P).most_common(10))
    print("variableUnit", C(p.get("synkkaData", {}).get("variableUnit") for p in P))
    print("has deposits", sum(bool(p.get("deposits")) for p in P))
    sub = [p for p in P if p.get("substitutions")]
    ids = {p["id"] for p in P}
    pairs = [(s["product"], s["substituteProduct"]) for p in sub for s in p["substitutions"]]
    print("subs products", len(sub), "pairs", len(pairs), "self-ref product==id", sum(s == p["id"] for p in sub for s, _ in [(x["product"], 0) for x in p["substitutions"]]),
          "sub missing from catalog", sum(t not in ids for _, t in pairs))
    byid = {p["id"]: p for p in P}
    print("sub same category", sum(byid[a]["category"] == byid[b]["category"] for a, b in pairs if a in byid and b in byid), "/", len(pairs))
    print("sub cats", C(byid[a]["category"] for a, _ in pairs if a in byid).most_common(10))
    print("rel coverage", sum(p["id"] in rel for p in P), "carbon coverage", sum(p["id"] in carb for p in P))
    print("rel dist", C(round(v, 1) for v in rel.values()).most_common())
    print("rel ids not in catalog", sum(k not in ids for k in rel), "carb ids not in catalog", sum(k not in ids for k in carb))
    sd = [p.get("synkkaData", {}) for p in P]
    for f in ["brand", "names", "classifications", "unitConversions", "ingredients", "nutritionalContent", "maxTemperature", "vatCode", "countriesOfOrigin"]:
        print("synkka has", f, sum(bool(s.get(f)) for s in sd))
    cls = C()
    for s in sd:
        for g in s.get("classifications") or []:
            cls[g["name"]] += 1
    print("classification groups", cls.most_common())
    lang = C(n.get("language") for s in sd for n in s.get("names") or [])
    print("name langs", lang.most_common())
    print("no fi name", sum(not fi_name(p) for p in P))


if __name__ == "__main__":
    main()
