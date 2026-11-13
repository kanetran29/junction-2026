# Valio Aimo – Trusted Trade Agents: data & API notes

Source: https://junction26.valioaimo.fi/ (challenge material, use only for this challenge). Local only, never push.

## Judging (poster in Discord #valio-aimo)
Working end-to-end demo 30 · Solving the user's need 20 · Autonomy & controls (guardrails) 20 ·
Robustness to exceptions 15 · Openness & path to production 15.
Flow: Request -> Lookup -> Order (fixed price) -> Approval. "Not a chatbot." "Query the APIs only when needed, never for all products."

## API (X-API-Key header, key is on the Junction platform; keep it in .env)
- `GET /api/ping`
- `POST /api/availability` body `{customer, requestedDate (date), products: [code] (1-1000)}` ->
  per product `closingTime` (order cut-off), `salesBlock`, `logisticModel`, `scheduleLines[{availableAmount, availableDate, salesUnit, salesBlock}]`
- `POST /api/price` same body -> per product `catalogPrice{value, valueWithTax, validFrom, validTo, currency}`, `listPrice`,
  `comparisonPrice` + `comparisonUnit` (e.g. per litre), `tax{taxRate, taxValue}`, `netPriceFound`, `error`; quantity always 1.0 sales unit
- `customer` is ignored in this challenge. >1000 products -> 422.
- `curl https://junction26.valioaimo.fi/openapi.json` redirects to HTML; read the spec in a browser (/docs or /redoc).

## Data files (data/)
- `product_data.json` (83 MB): 17,546 products, none deleted. Fields: id, salesUnit, baseUnit, allowedLotSize, category (numeric code),
  vendorName, countryOfOrigin, temperatureCondition, salesUnitGtin, units[{unitId, gtin, sizeInBaseUnits}], deposits,
  substitutions (only 196 products), synkkaData (GS1 Synkka: names fi/en/sv, ingredients, classifications incl. nutrition,
  safetyData, unitConversions with volume/weight, brand, storage...). Schema: `product_data_schema.json`.
- `delivery_reliability.csv`: 4,425 products (25 % coverage), 0..1.
- `carbon_footprint.csv`: 11,033 products (63 %), kg CO2-eq/kg, product-group average (all milks 1.1).

## The example request ("1,000 litres of lactose-free milk by Monday")
- 29 lactose-free milk-like products: 1 l cartons (sold per ST or per KI of 5/10/12/20), 10 l novobox (Valio Eila 463038, Arla 464179),
  2-2.5 dl portions, 1.75 l. Fat levels: rasvaton / kevyt / 1.5 % / 3 % / täysmaito; UHT vs ESL; "maito" vs "maitojuoma".
- Quantity must be converted litres -> base units -> sales units (KI multiples, allowedLotSize).
- Official substitutes exist for a few (e.g. 464306 -> 465039, 464398, 469363, 464201); everything else needs our own matching.
- Reliability is missing for many candidates (e.g. 462775, 463380, 464179) -> treat as unknown risk, not as 1.0.
- `closingTime` is a hard deadline: a human approval that arrives after cut-off misses Monday.

## Live API probe (Fri 13 Nov, delivery Mon 16 Nov; `scripts/probe_lactose_free.py`, 2 calls for 34 products)
- The API firewall returns 403 to the default `Python-urllib` user agent; send a custom User-Agent.
- `availableAmount` uses sentinels for "not stock-limited": 999999, 1e10 (and 1e10 / units-per-pack, e.g. 6.67e8). Treat as unlimited, never as a quantity.
- Two cut-off groups: stock products close Sun 15 Nov 17:00; order products (the 999999 ones: 10 l novobox, multipacks, 1.75 l)
  closed Thu 12 Nov 15:00, yet still report availableDate 16 Nov. They cannot make Monday: the agent must check closingTime vs now.
- Real limited stock exists: Arla rasvaton 1 l 51, Arla Café 1 l 698, Arla kevyt 1 l 384, Arla portion milk 384 l.
- `catalogPrice` is per sales unit (ST or KI); compare with `comparisonPrice` per L. Cheapest feasible: Valio Arki Eila kevyt 1 l (464306)
  1.01 €/l, reliability 1.0, cut-off Sun 17:00 -> 1,000 l is about 1,010 € before tax.
- Name search "laktoositon + maito" also returns chocolate, pudding and condensed milk: matching needs category / attributes.
- Official substitute 464201 -> 464440 (0.5 l) has availability 0 and no cut-off: a listed substitute can itself be unavailable.
