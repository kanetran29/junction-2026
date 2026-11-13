"""Independent oracle for the acceptance cases: computes expected facts from the product data and the recorded replies.

Applies the design's rules (orderable, unlimited sentinels, content per sales unit from the price ratio, whole sales
units, net/gross in cents) without sharing code with the TypeScript gateway, so the two can check each other.
Prints a summary and writes acceptance/expected_facts.json.

Usage: python3 -I scripts/acceptance/oracle.py data recordings/replies_2026-11-16.json acceptance
"""
import json
import math
import os
import sys

SENTINEL = 999999
NOW_FRI = "2026-11-13T21:10:00+02:00"
NOW_SUN_LATE = "2026-11-15T17:05:00+02:00"


def iso(t):
    """Normalise "+0200" offsets to "+02:00" so string comparison of same-offset times works."""
    return t[:-2] + ":" + t[-2:] if t and t[-5] in "+-" and t[-3] != ":" else t


def name(p, lang="fi"):
    """Product name in a language, falling back to the first one."""
    names = p["synkkaData"].get("names") or [{}]
    m = [n for n in names if str(n.get("language", "")).startswith(lang)]
    return (m or names)[0].get("value", "")


def ids_of(p, group, unit=None):
    """Classification ids in a group, optionally only those with a given unit (CONTAINS / FREE_FROM)."""
    return {v.get("id") for g in p["synkkaData"].get("classifications") or [] if g["name"] == group for v in g["values"] if unit is None or v.get("unit") == unit}


def orderable(av, pr, now, deliver_by="2026-11-16"):
    """(ok, code, limit) for one product at `now`, following the design's definition of orderable."""
    if pr is None or pr.get("error") or not pr.get("catalogPrice"):
        return False, "PRICE_UNAVAILABLE", None
    lines = [s for s in av.get("scheduleLines") or [] if s.get("availableAmount", 0) > 0]
    if not lines:
        return False, "NOT_ORDERABLE", None
    if av.get("salesBlock") or all(s.get("salesBlock") for s in lines):
        return False, "SALES_BLOCKED", None
    if not av.get("closingTime") or iso(av["closingTime"]) <= now:
        return False, "CUTOFF_PASSED", None
    if min(str(s.get("availableDate"))[:10] for s in lines) > deliver_by:
        return False, "DATE_NOT_MET", None
    amount = sum(s["availableAmount"] for s in lines if not s.get("salesBlock"))
    return True, "OK", None if amount >= SENTINEL else amount


def content(pr):
    """(litres or kg per sales unit, unit) from catalogPrice / comparisonPrice, or None."""
    cp, cmp_ = (pr.get("catalogPrice") or {}).get("value"), (pr.get("comparisonPrice") or {}).get("value")
    unit = (pr.get("comparisonUnit") or "").upper()
    if not cp or not cmp_ or unit not in ("L", "KG"):
        return None
    return round(cp / cmp_, 3), unit.lower()


def fill(qty, per_unit, lot=None):
    """Whole sales units covering `qty` (content units); returns (units, filled)."""
    step = lot or per_unit
    units = math.ceil(round(qty / step, 6)) * (step / per_unit)
    return units, round(units * per_unit, 3)


def money(pr, units):
    """(net cents, gross cents) for `units` sales units; gross from the tax rate on the net total."""
    net = round(pr["catalogPrice"]["value"] * 100 * units)
    rate = (pr.get("tax") or {}).get("taxRate", 0) or 0
    return net, round(net * (1 + rate / 100))


def main():
    """Compute the facts each acceptance case asserts and save them."""
    data_dir, rec_path, out_dir = sys.argv[1:4]
    P = {p["id"]: p for p in json.load(open(os.path.join(data_dir, "product_data.json"), encoding="utf-8"))}
    rec = json.load(open(rec_path, encoding="utf-8"))
    A = {x["productId"]: x for r in rec["availability"] for x in r["products"]}
    R = {x["productId"]: x for r in rec["price"] for x in r["products"]}
    facts = {"recordedTimeNow": rec["availability"][0]["timeNow"]}

    lf = [i for i, p in P.items() if p["category"] == "10400" and "FREE_FROM_LACTOSE" in ids_of(p, "nutritionalClaim")]
    rows = []
    for i in lf:
        ok, code, limit = orderable(A.get(i, {}), R.get(i), NOW_FRI)
        c = content(R[i]) if R.get(i) and not R[i].get("error") else None
        rows.append({"id": i, "name": name(P[i]), "brand": P[i]["synkkaData"].get("brand"), "salesUnit": P[i]["salesUnit"], "ok": ok, "code": code,
                     "limit": limit, "content": c, "eurPerUnit": (R.get(i) or {}).get("comparisonPrice", {}) and R[i]["comparisonPrice"]["value"],
                     "closingTime": A.get(i, {}).get("closingTime")})
    feasible = sorted([r for r in rows if r["ok"] and r["content"]], key=lambda r: r["eurPerUnit"])
    facts["lf_milk"] = {"candidates": len(lf), "orderable": len(feasible), "codes": {c: sum(r["code"] == c for r in rows) for c in {r["code"] for r in rows}}, "rows": rows}
    best = feasible[0]
    units, filled = fill(1000, best["content"][0])
    net, gross = money(R[best["id"]], units)
    facts["A1"] = {"product": best["id"], "name": best["name"], "salesUnits": units, "litres": filled, "netCents": net, "grossCents": gross,
                   "taxRate": R[best["id"]]["tax"]["taxRate"], "closingTime": best["closingTime"], "units": P[best["id"]]["units"]}
    late = [i for i in lf if orderable(A.get(i, {}), R.get(i), NOW_SUN_LATE)[0]]
    facts["B6_orderable_after_cutoff"] = len(late)
    facts["B1_bulk"] = [r for r in rows if r["content"] and r["content"][0] >= 10]
    facts["B2_arla"] = [r for r in rows if "arla" in (r["brand"] or "").lower() or "arla" in r["name"].lower()]
    facts["B3_sat_orderable"] = sum(orderable(A.get(i, {}), R.get(i), NOW_FRI, "2026-11-14")[0] for i in lf)

    chick = [i for i, p in P.items() if p["category"] == "18750" and "rintafilee" in name(p).lower()]
    crow = []
    for i in chick:
        ok, code, limit = orderable(A.get(i, {}), R.get(i), NOW_FRI)
        c = content(R[i]) if R.get(i) and not R[i].get("error") else None
        lot = P[i]["allowedLotSize"] if P[i]["allowedLotSize"] > 0.01 else None
        crow.append({"id": i, "name": name(P[i]), "ok": ok, "code": code, "limit": limit, "content": c, "lot": lot, "salesUnit": P[i]["salesUnit"],
                     "eurPerKg": ((R.get(i) or {}).get("comparisonPrice") or {}).get("value"), "variable": bool(P[i]["synkkaData"].get("variableUnit"))})
    cf = sorted([r for r in crow if r["ok"] and r["content"]], key=lambda r: r["eurPerKg"])
    facts["B5_chicken"] = {"candidates": len(chick), "orderable": len(cf), "feasible": cf[:5]}

    pairs = [(p["id"], s["substituteProduct"]) for p in P.values() for s in p.get("substitutions") or []]
    def st(i):
        """Orderable state of a product at Friday evening."""
        return orderable(A.get(i, {}), R.get(i), NOW_FRI)[1] if i in A else "NOT_RECORDED"
    lost_lf = [(a, b, name(P[a])[:40], name(P[b])[:40], st(a), st(b)) for a, b in pairs
               if "FREE_FROM_LACTOSE" in ids_of(P[a], "nutritionalClaim") and "FREE_FROM_LACTOSE" not in ids_of(P[b], "nutritionalClaim")]
    new_all = [(a, b, name(P[a])[:40], name(P[b])[:40], sorted(ids_of(P[b], "allergen", "CONTAINS") - ids_of(P[a], "allergen", "CONTAINS")), st(a), st(b)) for a, b in pairs
               if ids_of(P[b], "allergen", "CONTAINS") - ids_of(P[a], "allergen", "CONTAINS")]
    facts["C4_new_allergen_open"] = [x for x in new_all if x[6] == "OK"][:5]
    facts["C5_lost_lf_open"] = [x for x in lost_lf if x[5] == "OK"][:5]

    os.makedirs(out_dir, exist_ok=True)
    json.dump(facts, open(os.path.join(out_dir, "expected_facts.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("recorded timeNow", facts["recordedTimeNow"])
    print("LF milk candidates", facts["lf_milk"]["candidates"], "orderable", facts["lf_milk"]["orderable"], facts["lf_milk"]["codes"])
    print("A1", {k: v for k, v in facts["A1"].items() if k != "units"})
    print("next cheapest:", [(r["id"], r["name"][:35], r["eurPerUnit"], r["limit"]) for r in feasible[1:4]])
    print("B1 bulk", [(r["id"], r["name"][:35], r["code"], r["closingTime"]) for r in facts["B1_bulk"]])
    print("B2 arla", [(r["id"], r["name"][:35], r["code"], r["limit"], r["content"]) for r in facts["B2_arla"]])
    print("B3 orderable for Sat 14 Nov", facts["B3_sat_orderable"], "| B6 orderable at Sun 17:05", facts["B6_orderable_after_cutoff"])
    print("B5 chicken", facts["B5_chicken"]["candidates"], "orderable", facts["B5_chicken"]["orderable"], [(r["id"], r["name"][:30], r["limit"], r["lot"], r["eurPerKg"], r["salesUnit"], r["variable"]) for r in cf[:3]])
    print("C4 new allergen, substitute open:", facts["C4_new_allergen_open"][:3])
    print("C5 loses lactose-free, substitute open:", facts["C5_lost_lf_open"][:3])


if __name__ == "__main__":
    main()
