import type { Env } from './env';
import { db } from './db';

const REPLAY_FROM = Date.parse('2026-11-15T15:00:00Z');

/**
 * Reads one row of the key/value `settings` table (clock override, replay flag, recording, variant); null when unset.
 */
export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await db(env).prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** The features that ship switched off and are switched on with the admin key once verified live. */
export const FEATURES = ['connector', 'voice', 'peppol'] as const;
export type Feature = (typeof FEATURES)[number];

/** True when a feature was switched on with `/admin/feature` (settings key `feature_<name>`); every feature defaults off. */
export async function featureOn(env: Env, name: Feature): Promise<boolean> {
  return (await getSetting(env, `feature_${name}`)) === '1';
}

/**
 * The gateway's current time: the stored override when DEMO_MODE is "1" and one is set, else real time.
 * Every cutoff, expiry and replay decision reads this, so demos can run on a scripted clock.
 */
export async function now(env: Env): Promise<Date> {
  if (env.DEMO_MODE === '1') {
    const override = await getSetting(env, 'clock');
    if (override) return new Date(override);
  }
  return new Date();
}

/**
 * Sets (ISO string) or clears (null) the demo clock override; the override only takes effect when DEMO_MODE is "1".
 * The string must end in `Z` or an explicit offset (a bare local time would silently land hours off, so it throws);
 * the stored value is normalised to UTC `Z`.
 */
export async function setClock(env: Env, iso: string | null): Promise<void> {
  if (iso === null) {
    await db(env).prepare("DELETE FROM settings WHERE key = 'clock'").run();
    return;
  }
  await db(env).prepare("INSERT INTO settings(key, value) VALUES('clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(normaliseClock(iso))
    .run();
}

/** Checks a clock string (it needs `Z` or an explicit offset and must be a real time) and returns it as UTC `Z`; throws otherwise. */
export function normaliseClock(iso: string): string {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) throw new Error(`clock needs Z or an offset: ${iso}`);
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) throw new Error(`invalid clock: ${iso}`);
  return t.toISOString();
}

/**
 * Whether replay mode (serve recorded Valio replies) is on: the settings row `replay` = "1" forces it,
 * otherwise it is on once now() reaches 2026-11-15T15:00:00Z.
 */
export async function replayOn(env: Env): Promise<boolean> {
  if ((await getSetting(env, 'replay')) === '1') return true;
  return (await now(env)).getTime() >= REPLAY_FROM;
}

/**
 * Formats a date as Helsinki local time with the fixed `+02:00` offset used in every reply
 * (e.g. 2026-11-13T21:10:00+02:00); Helsinki is +02:00 throughout this event, so no DST handling is needed.
 */
export function helsinkiIso(d: Date): string {
  return new Date(d.getTime() + 2 * 3600_000).toISOString().replace(/\.\d{3}Z$/, '+02:00');
}
