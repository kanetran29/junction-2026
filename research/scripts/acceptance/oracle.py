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


def half_up(x):
    """Round a non-negative number of cents half up (Python's round() is half-to-even)."""
    return int(math.floor(x + 0.5))


def review2_facts(P, A, R, data_dir):
    """Facts for the REVIEW-2 cases: stock contention, approval races, split orders, baskets, name and GTIN resolution, occasion search."""
    def cents(i):
        """Net price of one sales unit in cents."""
        return half_up(R[i]["catalogPrice"]["value"] * 100)

    def limit(i):
        """Limited stock of an orderable product on Friday evening, None when not limited."""
        ok, code, lim = orderable(A[i], R[i], NOW_FRI)
        assert ok, (i, code)
        return lim

    def edits(s, t):
        """Levenshtein distance between two short strings."""
        row = list(range(len(t) + 1))
        for i, cs in enumerate(s, 1):
            prev, row[0] = row[0], i
            for j, ct in enumerate(t, 1):
                prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (cs != ct))
        return row[-1]

    def snapped(i):
        """Content per sales unit from the price ratio, snapped to one decimal when within 2 % (4.998 kg -> 5 kg)."""
        raw = content(R[i])[0]
        near = round(raw, 1)
        return near if near and abs(near - raw) / raw < 0.02 else raw

    def line(i, qty):
        """One basket line: whole sales units covering qty content units, respecting a real lot step."""
        per = snapped(i)
        lot = P[i]["allowedLotSize"] if P[i]["allowedLotSize"] > 0.01 else None
        units, filled = fill(qty, per, lot)
        return {"productId": i, "salesUnits": units, "filled": filled, "netCents": half_up(cents(i) * units), "taxRate": R[i]["tax"]["taxRate"]}

    def basket(lines):
        """Net and gross totals of a basket; gross is computed per tax rate on the net sum, half up."""
        net = sum(l["netCents"] for l in lines)
        by_rate = {}
        for l in lines:
            by_rate[l["taxRate"]] = by_rate.get(l["taxRate"], 0) + l["netCents"]
        gross = sum(half_up(v * (1 + r / 100)) for r, v in by_rate.items())
        return {"lines": lines, "netCents": net, "grossCents": gross}

    out = {}
    a, b = "462775", "469363"
    assert limit(a) == 51 and limit(b) == 384
    out["contention_462775"] = {"limit": 51, "unitCents": cents(a), "each30NetCents": 30 * cents(a), "leftAfter30": 21, "requote30": {"filled": 21, "shortfall": 9, "netCents": 21 * cents(a)},
                                "each40NetCents": 40 * cents(a), "leftAfter40": 11}
    out["hold_469363"] = {"limit": 384, "unitCents": cents(b), "held250NetCents": 250 * cents(b), "freeWhileHeld": 134, "b150WhileHeld": {"filled": 134, "shortfall": 16, "netCents": 134 * cents(b)},
                          "b150AfterRelease": {"filled": 150, "netCents": 150 * cents(b)}, "leftForApproval": 234}

    lf = [i for i, p in P.items() if p["category"] == "10400" and "FREE_FROM_LACTOSE" in ids_of(p, "nutritionalClaim") and i in A and orderable(A[i], R.get(i), NOW_FRI)[0]]
    assert min(lf, key=lambda i: R[i]["comparisonPrice"]["value"]) == "464306"
    butter = [i for i, p in P.items() if p["category"] == "10500" and i in A and orderable(A[i], R.get(i), NOW_FRI)[0]]
    assert min(butter, key=lambda i: R[i]["comparisonPrice"]["value"]) == "464411"
    out["butter_orderable"] = sorted((R[i]["comparisonPrice"]["value"], i, name(P[i])) for i in butter)
    out["basket_held"] = basket([line("464306", 300), line("464411", 20), line("472673", 30)])
    out["basket_auto"] = basket([line("464306", 100), line("464411", 10), line("472673", 20)])
    out["basket_auto_two_lines"] = basket([line("464306", 100), line("464411", 10)])
    tork = "472822"
    assert orderable(A[tork], R[tork], NOW_FRI)[0] and R[tork]["tax"]["taxRate"] == 25.5
    mixed = [line("464306", 100), {"productId": tork, "salesUnits": 2, "filled": 2, "netCents": 2 * cents(tork), "taxRate": 25.5}]
    out["basket_mixed_vat"] = basket(mixed)
    out["split_brief_example"] = {"litres": [334, 333, 333], "netCents": [l * cents("464306") for l in (334, 333, 333)], "sumNetCents": 1000 * cents("464306"),
                                  "cumulative": [334 * cents("464306"), 667 * cents("464306"), 1000 * cents("464306")]}
    with open(os.path.join(data_dir, "delivery_reliability.csv"), encoding="utf-8") as f:
        rel = {r.split(",")[0]: float(r.split(",")[1]) for r in f.read().split()[1:]}
    out["reliability"] = {i: rel.get(i) for i in ("464306", "464411", "472673", "462281", "462775", "469363", tork)}
    fam = [i for i, p in P.items() if p["category"] in ("10400", "18750", "10500") and i in A and orderable(A[i], R.get(i), NOW_FRI)[0]]
    out["reliability_known_in_three_families"] = {"orderable": len(fam), "known": sum(i in rel for i in fam)}
    race = sorted((orderable(A[i], R[i], NOW_FRI)[2], cents(i), i, name(P[i]), P[i]["salesUnit"]) for i in fam if orderable(A[i], R[i], NOW_FRI)[2] is not None and rel.get(i, 0) >= 0.9)
    out["limited_with_known_reliability"] = race
    out["approval_race_469363"] = {"limit": 384, "a250NetCents": 250 * cents(b), "b150NetCents": 150 * cents(b), "leftAfterB": 234}
    top_choice, breast = "470746", "462281"
    assert limit(top_choice) == 6 and limit(breast) == 198 and rel.get(top_choice, 0) >= 0.9 and rel.get(breast, 0) >= 0.9
    four = line(top_choice, 20)
    assert four["salesUnits"] == 4
    out["race_470746"] = {"limit": 6, "contentKgRaw": content(R[top_choice])[0], "contentKg": snapped(top_choice), "each20kg": four, "leftUnits": 2,
                          "requote20kg": {"filledKg": 10, "shortfallKg": 10, "netCents": 2 * cents(top_choice)}, "sameTypeAlternative": line("472673", 20)}
    a_line, b_line = line(breast, 150), line(breast, 60)
    out["approval_race_462281"] = {"limitKg": 198, "a150kg": a_line, "b60kg": b_line, "leftKg": round(198 - b_line["filled"], 3), "aFits": 198 - b_line["filled"] >= a_line["filled"]}
    assert not out["approval_race_462281"]["aFits"]
    terms = ("juhla", "party", "cocktail", "buffet")
    per_cat, size = {}, {}
    for p in P.values():
        size[p["category"]] = size.get(p["category"], 0) + 1
        blob = " ".join((x.get("value") or "") for k in ("marketingTexts", "usageInstructions") for x in p["synkkaData"].get(k) or []).lower()
        # Own names and brand are removed first, so "Juhla Mokka" coffee is not evidence of a party.
        for own in [(n.get("value") or "").lower() for n in p["synkkaData"].get("names") or []] + [(p["synkkaData"].get("brand") or "").lower().strip()]:
            if own:
                blob = blob.replace(own, " ")
        if any(t in blob for t in terms):
            per_cat[p["category"]] = per_cat.get(p["category"], 0) + 1
    top = sorted(per_cat.items(), key=lambda kv: (-kv[1], kv[0]))[:8]
    out["occasion_party"] = {"terms": terms, "products": sum(per_cat.values()), "categories": len(per_cat), "coffee22300": per_cat.get("22300", 0),
                             "top": [{"category": c, "mentions": m, "of": size[c], "sample": [name(p, "en") for p in P.values() if p["category"] == c][:2]} for c, m in top]}
    ok, code, _ = orderable(A["463038"], R.get("463038"), NOW_FRI)
    out["unmet_reference_463038"] = {"ok": ok, "code": code, "closingTime": A["463038"].get("closingTime")}

    by_gtin = {}
    for p in P.values():
        if p.get("salesUnitGtin"):
            by_gtin.setdefault(p["salesUnitGtin"], []).append(p["id"])
    out["gtin"] = {"464306": P["464306"]["salesUnitGtin"], "resolvesTo": by_gtin[P["464306"]["salesUnitGtin"]], "sharedSalesUnitGtins": sum(len(v) > 1 for v in by_gtin.values())}
    same = [p["id"] for p in P.values() if name(p).strip().lower() == "kantolan ballerina toffee täytekeksi 190g"]
    out["identical_name"] = {"name": "Kantolan Ballerina toffee täytekeksi 190g", "products": sorted(same), "salesUnits": {i: P[i]["salesUnit"] for i in same}}
    norm = lambda s: "".join(ch for ch in (s or "").lower() if ch.isalnum())
    brands = {norm(p["synkkaData"].get("brand")) for p in P.values()}
    out["brands"] = {"pirkkaCarried": "pirkka" in brands, "arlaCarried": "arla" in brands, "distinctNormalised": len(brands - {""})}
    out["brand_neighbours"] = {q: sorted(b for b in brands - {""} if edits(q, b) <= 1) for q in ("pirkka", "arrla", "oatley", "valo", "danone")}
    toks = ["lactose", "free", "milk"]
    hits = [p for p in P.values() if all(t in " ".join((n.get("value") or "").lower() for n in p["synkkaData"].get("names") or []) for t in toks)]
    out["name_lactose_free_milk"] = {"products": len(hits), "categories": len({p["category"] for p in hits}), "in10400": sum(p["category"] == "10400" for p in hits)}
    return out


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

    facts["R2"] = review2_facts(P, A, R, data_dir)
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
    print("R2", json.dumps(facts["R2"], ensure_ascii=False))


if __name__ == "__main__":
    main()
