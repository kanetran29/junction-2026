"""Explore how to find lactose-free milk without name matching: categories, classification ids, units, lot sizes.

Usage: python3 -I scripts/analysis/explore_lf.py data
"""
import collections
import json
import os
import re
import sys

EXCLUDE = re.compile(r"rahka|jauhe|kaakao|kahvi|jogurt|juusto|jäätelö|kerma|voi|latte|play|plus", re.I)


def name(p, lang="fi"):
    """Product name in a language, falling back to the first one."""
    names = p["synkkaData"].get("names") or [{}]
    m = [n for n in names if str(n.get("language", "")).startswith(lang)]
    return (m or names)[0].get("value", "")


def cls(p):
    """Map classification group name -> list of (id, unit, value)."""
    return {g["name"]: [(v.get("id"), v.get("unit"), v.get("value")) for v in g["values"]] for g in p["synkkaData"].get("classifications") or []}


def main():
    """Print category/classification evidence for lactose-free milk."""
    P = json.load(open(os.path.join(sys.argv[1], "product_data.json"), encoding="utf-8"))
    lf = [p for p in P if "laktoositon" in name(p).lower() and "maito" in name(p).lower() and not EXCLUDE.search(name(p))]
    print("LF milk name matches", len(lf), collections.Counter(p["category"] for p in lf))
    for p in lf[:4]:
        c = cls(p)
        print(p["id"], name(p), "|", name(p, "en"), "| cat", p["category"], "| su", p["salesUnit"], "bu", p["baseUnit"], "lot", p["allowedLotSize"],
              "units", p["units"], "temp", p["temperatureCondition"])
        for g, vals in c.items():
            print("   ", g, vals[:12])
        print("    unitConv", p["synkkaData"].get("unitConversions"))
    cats = {p["category"] for p in lf}
    for c in sorted(cats):
        inc = [p for p in P if p["category"] == c]
        print("\nCATEGORY", c, len(inc), "examples:", [name(p)[:40] for p in inc[:12]])
    ids = collections.Counter()
    for p in P:
        for g in p["synkkaData"].get("classifications") or []:
            for v in g["values"]:
                ids[(g["name"], v.get("id"), v.get("unit"))] += 1
    print("\nclassification enum ids (top 80):")
    for k, n in ids.most_common(80):
        print(n, k)


if __name__ == "__main__":
    main()
