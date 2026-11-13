"""Find category codes for buyer-request keywords (name search only to discover the code, then select by code).

Usage: python3 -I scripts/analysis/find_cats.py data kw1 kw2 ...
"""
import collections
import json
import os
import sys


def name(p):
    """Finnish name or the first name."""
    names = p["synkkaData"].get("names") or [{}]
    m = [n for n in names if str(n.get("language", "")).startswith("fi")]
    return (m or names)[0].get("value", "")


P = json.load(open(os.path.join(sys.argv[1], "product_data.json"), encoding="utf-8"))
for kw in sys.argv[2:]:
    hits = [p for p in P if kw.lower() in name(p).lower()]
    cats = collections.Counter(p["category"] for p in hits).most_common(4)
    print(f"\n## {kw}: {len(hits)} hits, cats {cats}")
    for c, _ in cats[:2]:
        inc = [p for p in P if p["category"] == c]
        print(f"  cat {c} ({len(inc)}):", "; ".join(f"{p['id']} {name(p)[:38]} [{p['salesUnit']},t{p.get('temperatureCondition')}]" for p in inc[:7]))
