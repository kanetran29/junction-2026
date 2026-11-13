"""Probe the Valio Aimo mock APIs for the poster's example request.

Finds lactose-free milk products in the product data, asks the availability and price APIs for one delivery
date, and prints litres per sales unit, stock, cut-off, price per litre and delivery reliability, then how far
the stock goes toward 1,000 litres. Reads VALIO_API_KEY / VALIO_API_BASE from the environment (see .env).

Usage: python3 -I scripts/probe_lactose_free.py data 2026-11-16
"""
import csv
import json
import os
import re
import sys
import urllib.request

EXCLUDE = re.compile(r"rahka|jauhe|kaakao|kahvi|jogurt|juusto|jäätelö|kerma|voi|latte|play|plus", re.I)
VOLUME = re.compile(r"(\d+(?:[.,]\d+)?)\s*(l|dl|cl)\b", re.I)


def fi_name(product):
    """Finnish product name, falling back to the first name given."""
    names = product["synkkaData"].get("names") or [{}]
    fi = [n for n in names if str(n.get("language", "")).startswith("fi")]
    return (fi or names)[0].get("value", "")


def litres_per_base_unit(name):
    """Litres in one base unit, parsed from the name ("1 l", "2,5 dl", "100x2 cl"); None when not stated."""
    m = VOLUME.search(name)
    if not m:
        return None
    value = float(m.group(1).replace(",", ".")) * {"l": 1, "dl": 0.1, "cl": 0.01}[m.group(2).lower()]
    multi = re.search(r"(\d+)\s*x\s*\d", name)
    return value * int(multi.group(1)) if multi else value


def call(path, body):
    """POST JSON to the mock API with the key header and return the parsed reply."""
    req = urllib.request.Request(
        os.environ["VALIO_API_BASE"] + path,
        data=json.dumps(body).encode(),
        # The API's firewall answers 403 to the default "Python-urllib" user agent.
        headers={"X-API-Key": os.environ["VALIO_API_KEY"], "Content-Type": "application/json", "User-Agent": "junction26-probe/0.1"},
        method="POST",
    )
    return json.load(urllib.request.urlopen(req, timeout=30))


def main():
    """Collect candidates, query both APIs once each, print the table and the 1,000 l coverage."""
    data_dir, date = sys.argv[1], sys.argv[2]
    products = json.load(open(os.path.join(data_dir, "product_data.json"), encoding="utf-8"))
    rel = {r[0]: r[1] for r in list(csv.reader(open(os.path.join(data_dir, "delivery_reliability.csv"))))[1:]}
    cands = [p for p in products if "laktoositon" in fi_name(p).lower() and "maito" in fi_name(p).lower() and not EXCLUDE.search(fi_name(p))]
    ids = [p["id"] for p in cands]
    body = {"customer": "junction-probe", "requestedDate": date, "products": ids}
    avail = {a["productId"]: a for a in call("/api/availability", body)["products"]}
    price = {p["productId"]: p for p in call("/api/price", body)["products"]}
    print(f"{len(ids)} candidates, delivery {date}, 2 API calls")
    total = 0.0
    for p in cands:
        a, pr = avail.get(p["id"], {}), price.get(p["id"], {})
        per_sales = {u["unitId"]: u["sizeInBaseUnits"] for u in p["units"]}.get(p["salesUnit"], 1.0)
        lpb = litres_per_base_unit(fi_name(p))
        litres_per_sales = lpb * per_sales if lpb else None
        lines = [s for s in a.get("scheduleLines", []) if not s.get("salesBlock")]
        amount = sum(s["availableAmount"] for s in lines)
        when = ",".join(sorted({str(s.get("availableDate"))[:10] for s in lines})) or "-"
        cat = (pr.get("catalogPrice") or {}).get("value")
        cmp_ = pr.get("comparisonPrice") or {}
        litres = amount * litres_per_sales if litres_per_sales else 0
        total += litres
        print(f"{p['id']} | {fi_name(p)[:48]:48} | {p['salesUnit']}={litres_per_sales or '?'} l | avail {amount:g} on {when} | "
              f"block {a.get('salesBlock')} | cutoff {a.get('closingTime')} | {cat} €/{p['salesUnit']} | cmp {cmp_.get('value')} €/{pr.get('comparisonUnit')} | "
              f"rel {rel.get(p['id'], 'n/a')} | ~{litres:.0f} l")
    print(f"total available ~{total:.0f} l of 1000 l")


if __name__ == "__main__":
    main()
