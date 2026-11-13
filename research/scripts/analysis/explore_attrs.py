"""Check attribute-based selection: lactose flags vs names in category 10400, temperature code meanings,
volume sources (synkka volume vs name), lot size and variable-weight traps.

Usage: python3 -I scripts/analysis/explore_attrs.py data
"""
import collections
import json
import os
import sys


def name(p, lang="fi"):
    """Product name in a language, falling back to the first one."""
    names = p["synkkaData"].get("names") or [{}]
    m = [n for n in names if str(n.get("language", "")).startswith(lang)]
    return (m or names)[0].get("value", "")


def groups(p):
    """Map classification group -> {id: (unit, value)}."""
    return {g["name"]: {v.get("id"): (v.get("unit"), v.get("value")) for v in g["values"]} for g in p["synkkaData"].get("classifications") or []}


def lactose_flags(p):
    """Return (claim FREE_FROM_LACTOSE, nonAllergen ML free, LACS grams or None, allergen ML contains)."""
    g = groups(p)
    lacs = (g.get("nutritionFact", {}).get("LACS") or (None, None))[1]
    return ("FREE_FROM_LACTOSE" in g.get("nutritionalClaim", {}), "ML" in g.get("nonAllergen", {}), lacs, "ML" in g.get("allergen", {}))


def base_volume(p):
    """Litres per base unit from synkka unitConversions, or None."""
    for u in p["synkkaData"].get("unitConversions") or []:
        if u.get("synkkaPackagingType") == "BASE_UNIT_OR_EACH" and u.get("volume"):
            v = u["volume"]
            return v["value"] * {"LTR": 1, "MLT": 0.001, "CLT": 0.01, "DLT": 0.1}.get(v["unit"], float("nan")), v["unit"]
    return None


def main():
    """Print the checks."""
    P = json.load(open(os.path.join(sys.argv[1], "product_data.json"), encoding="utf-8"))
    milk = [p for p in P if p["category"] == "10400"]
    print("== category 10400 (drinking milk):", len(milk))
    for p in milk:
        f = lactose_flags(p)
        nm = name(p)
        lf_name = "laktoositon" in nm.lower()
        flag = f[0] or f[1] or (f[2] is not None and f[2] < 0.1)
        mark = "" if lf_name == flag else "  <-- MISMATCH"
        if lf_name or flag:
            print(f"{p['id']} {nm[:55]:55} claim={f[0]} mlFree={f[1]} LACS={f[2]} su={p['salesUnit']} units={[(u['unitId'], u['sizeInBaseUnits']) for u in p['units']]} vol={base_volume(p)} temp={p['temperatureCondition']}{mark}")
    print("\n== lactose flag coverage overall")
    c = collections.Counter()
    for p in P:
        f = lactose_flags(p)
        c[(f[0], f[1], f[2] is not None)] += 1
    print(c.most_common())
    print("\n== temperatureCondition vs label and min/max temp")
    t = collections.defaultdict(collections.Counter)
    tr = collections.defaultdict(list)
    for p in P:
        lab = [k for k in groups(p).get("packagingMarkedLabel", {}) if k.endswith("Temperature")]
        t[p.get("temperatureCondition")][tuple(lab)] += 1
        if p["synkkaData"].get("maxTemperature") is not None:
            tr[p.get("temperatureCondition")].append(p["synkkaData"]["maxTemperature"])
    for k in sorted(t, key=str):
        mx = sorted(tr[k])
        print(k, t[k].most_common(3), "maxTemp median", mx[len(mx) // 2] if mx else None, "examples", [name(p)[:30] for p in P if p.get("temperatureCondition") == k][:4])
    print("\n== volume coverage for liquids: base unit volume present", sum(base_volume(p) is not None for p in P))
    print("\n== lot sizes != 0.01 examples")
    for p in [p for p in P if p["allowedLotSize"] not in (0.01,)][:8]:
        print(p["id"], name(p)[:45], p["salesUnit"], p["allowedLotSize"], [(u['unitId'], u['sizeInBaseUnits']) for u in p['units']])
    print("\n== variable weight (KG sold) examples")
    for p in [p for p in P if p["synkkaData"].get("variableUnit")][:6]:
        print(p["id"], name(p)[:45], p["salesUnit"], p["baseUnit"], p["allowedLotSize"], [(u['unitId'], u['sizeInBaseUnits']) for u in p['units']])
    print("\n== sales unit not in units list", sum(p["salesUnit"] not in {u["unitId"] for u in p["units"]} for p in P))
    print("== units with odd unitIds", collections.Counter(u["unitId"] for p in P for u in p["units"]).most_common(20))


if __name__ == "__main__":
    main()
