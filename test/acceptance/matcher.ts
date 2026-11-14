type Json = any;
type Tok = { k: 'key'; v: string } | { k: 'idx'; v: number } | { k: 'star' } | { k: 'sel'; f: string; v: string };

/**
 * Splits a case path such as `rejections[productId=X].code` or `offers[*].lines[0]` into tokens
 * (dot keys, `[n]` indexes, `[*]` maps and `[field=value]` selectors).
 */
function tokenize(path: string): Tok[] {
  const out: Tok[] = [];
  for (const m of path.matchAll(/([^.[\]]+)|\[([^\]]*)\]/g)) {
    const b = m[2];
    if (b === undefined) out.push({ k: 'key', v: m[1] });
    else if (b === '*') out.push({ k: 'star' });
    else if (/^\d+$/.test(b)) out.push({ k: 'idx', v: Number(b) });
    else {
      const i = b.indexOf('=');
      out.push({ k: 'sel', f: b.slice(0, i), v: b.slice(i + 1) });
    }
  }
  return out;
}

/**
 * Walks `node` along `toks`. `[*]` maps over an array and flattens when another `[*]` follows;
 * `[f=X]` picks the first element whose field equals X (as strings), or all of them when `all`
 * is set (used by `count(...)`). A missing step yields `undefined`.
 */
function walk(node: Json, toks: Tok[], all: boolean): Json {
  if (!toks.length) return node;
  const [t, ...rest] = toks;
  if (node === null || node === undefined) return undefined;
  switch (t.k) {
    case 'key':
      return walk(node[t.v], rest, all);
    case 'idx':
      return Array.isArray(node) ? walk(node[t.v], rest, all) : undefined;
    case 'star': {
      if (!Array.isArray(node)) return undefined;
      const mapped = node.map((x) => walk(x, rest, all));
      return rest.some((r) => r.k === 'star') ? mapped.flat() : mapped;
    }
    case 'sel': {
      if (!Array.isArray(node)) return undefined;
      const hit = (e: Json) => String(e?.[t.f]) === t.v;
      return all && !rest.length ? node.filter(hit) : walk(node.find(hit), rest, all);
    }
  }
}

/** Reads the value a case path points at; `count(path)` yields the number of selector matches. */
function read(reply: Json, path: string): Json {
  const c = /^count\((.*)\)$/.exec(path);
  if (c) {
    const r = walk(reply, tokenize(c[1]), true);
    return Array.isArray(r) ? r.length : 0;
  }
  return walk(reply, tokenize(path), false);
}

/** Deep equality where numbers match within 1e-9 (money-like values such as 136.4). */
function equal(a: Json, b: Json): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => equal(a[k], b[k]));
}

/** `=` treats an absent value as equal to an expected `null`. */
function eq(got: Json, want: Json): boolean {
  return want === null ? got === null || got === undefined : equal(got, want);
}

/**
 * Membership for `contains`: array element (deep equal), substring of a string, or key of a plain object
 * (OpenAPI `paths`); undefined when `got` is none of those, so both `contains` and `not_contains` fail.
 */
function has(got: Json, want: Json): boolean | undefined {
  if (Array.isArray(got)) return got.some((x) => equal(x, want));
  if (typeof got === 'string') return got.includes(String(want));
  if (got !== null && typeof got === 'object') return Object.hasOwn(got, String(want));
  return undefined;
}

/**
 * Checks one acceptance expectation `[path, op, value]` against a reply and returns the verdict
 * together with the value the path resolved to, so the runner can print what it saw.
 */
export function match(reply: unknown, [path, op, want]: [string, string, unknown]): { ok: boolean; got: unknown } {
  const got = read(reply, path);
  const num = (f: (a: number, b: number) => boolean) => typeof got === 'number' && f(got, want as number);
  let ok: boolean;
  switch (op) {
    case '=':
      ok = eq(got, want);
      break;
    case '!=':
      ok = !eq(got, want);
      break;
    case 'contains':
      ok = has(got, want) === true;
      break;
    case 'not_contains':
      ok = has(got, want) === false;
      break;
    case '>=':
      ok = num((a, b) => a >= b);
      break;
    case '<=':
      ok = num((a, b) => a <= b);
      break;
    case 'count=':
      ok = Array.isArray(got) && got.length === want;
      break;
    case 'matches':
      ok = typeof got === 'string' && new RegExp(want as string).test(got);
      break;
    default:
      throw new Error(`unknown op ${op}`);
  }
  return { ok, got };
}
