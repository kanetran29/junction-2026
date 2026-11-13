#!/usr/bin/env bash
# Downloads the Valio Aimo challenge material into .data/valio/data (gitignored) and, when VALIO_API_KEY is set,
# records live price/availability replies into .data/valio/recordings for the acceptance cases and demo replay.
# The dataset may only be used for this challenge; it is never committed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/.data/valio"
BASE="${VALIO_API_BASE:-https://junction26.valioaimo.fi}"
mkdir -p "$OUT/data" "$OUT/recordings"

# Saves one public challenge file under the name the scripts expect.
get() { curl -fsSL -o "$OUT/data/$2" "$BASE/files/$1"; }

get 32825daf25fcd6023c3b43028cf0b191/valio_aimo_junction26_product_data.json product_data.json
get 008f9a50ba9a6538d2e5bdf29d592af8/valio_aimo_junction26_product_data_schema.json product_data_schema.json
get fc0b960c5db8a49fb3b85e02a7f70b78/valio_aimo_junction26_delivery_reliability.csv delivery_reliability.csv
get 6d3b5d4ee6de9b5153b70beb27812efe/valio_aimo_junction26_carbon_footprint.csv carbon_footprint.csv
ls -la "$OUT/data"

if [ -n "${VALIO_API_KEY:-}" ]; then
  VALIO_API_BASE="$BASE" python3 -I "$ROOT/research/scripts/record_replies.py" "$OUT/data" "$OUT/recordings" 2026-11-16 10400,18750,10500
  python3 -I "$ROOT/research/scripts/acceptance/oracle.py" "$OUT/data" "$OUT/recordings/replies_2026-11-16.json" "$OUT/acceptance"
else
  echo "VALIO_API_KEY not set: skipped recording replies"
fi
