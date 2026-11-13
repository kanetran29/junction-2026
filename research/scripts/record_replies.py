"""Record live Valio mock API replies for the product sets the acceptance tests and the demo replay need.

Records availability and price for: every product in the given category codes, every product that has an official
substitution, and every substitute. One call per endpoint per 1,000 ids. Writes recordings/<label>.json with the
request date, the ids and both raw replies (local repo only, never the public project repo).

Usage: python3 -I scripts/record_replies.py data recordings 2026-11-16 10400,18750,10500
"""
import json
import os
import sys
import urllib.request


def call(path, body):
    """POST JSON to the mock API with the key header and a custom User-Agent, return the parsed reply."""
    req = urllib.request.Request(
        os.environ["VALIO_API_BASE"] + path,
        data=json.dumps(body).encode(),
        # The API's firewall answers 403 to the default "Python-urllib" user agent.
        headers={"X-API-Key": os.environ["VALIO_API_KEY"], "Content-Type": "application/json", "User-Agent": "junction26-recorder/0.1"},
        method="POST",
    )
    return json.load(urllib.request.urlopen(req, timeout=60))


def main():
    """Pick the ids, call both endpoints in chunks of 1,000 and save one JSON file."""
    data_dir, out_dir, date, cats = sys.argv[1], sys.argv[2], sys.argv[3], set(sys.argv[4].split(","))
    products = json.load(open(os.path.join(data_dir, "product_data.json"), encoding="utf-8"))
    ids = {p["id"] for p in products if p["category"] in cats}
    for p in products:
        for s in p.get("substitutions") or []:
            ids.update([s["product"], s["substituteProduct"]])
    ids = sorted(ids)
    avail, price, calls = [], [], 0
    for i in range(0, len(ids), 1000):
        chunk = ids[i:i + 1000]
        body = {"customer": "junction26-recorder", "requestedDate": date, "products": chunk}
        a = call("/api/availability", body)
        p = call("/api/price", body)
        avail.append(a)
        price.append(p)
        calls += 2
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"replies_{date}.json")
    json.dump({"requestedDate": date, "categories": sorted(cats), "ids": ids, "calls": calls, "availability": avail, "price": price},
              open(out, "w", encoding="utf-8"))
    print(f"{len(ids)} ids, {calls} calls, timeNow {avail[0].get('timeNow')} -> {out}")


if __name__ == "__main__":
    main()
