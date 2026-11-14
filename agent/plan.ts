/** What the buyer's agent knows about its own mandate: the per-order amount it may place without a human. */
export interface Mandate {
  autoCents: number;
}

/** The buyer's standing preferences, used to fill what a draft leaves unclear. */
export interface BuyerProfile {
  fatLevel?: string;
  packLitres?: number;
}

/** The fields of a quoted offer the choice reads. */
export interface PlanOffer {
  offerId: string;
  netCents: number;
  shortfall: number;
  changes: string[];
}

/** An offer stays AUTO when it fits the per-order limit and needs no approval-worthy change (substitute, pack, shortfall). */
const staysAuto = (o: PlanOffer, m: Mandate) => o.netCents <= m.autoCents && o.changes.length === 0 && o.shortfall === 0;

/**
 * Picks the offer to place: among offers that cover the need (all offers only when none does), an offer that stays AUTO
 * and costs at most 5 % more than the cheapest wins, otherwise the cheapest. The gateway still decides; this only avoids
 * needless approvals when the price difference is small.
 */
export function chooseWithinMandate<T extends PlanOffer>(offers: T[], mandate: Mandate): T | undefined {
  const covering = offers.filter((o) => o.shortfall === 0);
  const pool = [...(covering.length ? covering : offers)].sort((a, b) => a.netCents - b.netCents);
  if (!pool.length) return undefined;
  const ceiling = pool[0].netCents * 1.05;
  return pool.find((o) => staysAuto(o, mandate) && o.netCents <= ceiling) ?? pool[0];
}

/**
 * The `fill` for a draft's unclear fields from the profile: fat level defaults to "any", the pack size comes only from
 * the profile; anything else stays unfilled so the draft is not confirmed on a guess.
 */
export function fillUnclear(draft: { unclear: string[] }, profile: BuyerProfile): Record<string, unknown> {
  const fill: Record<string, unknown> = {};
  for (const u of draft.unclear) {
    if (u === 'fatLevel') fill.fatLevel = profile.fatLevel ?? 'any';
    else if (u === 'packLitres' && profile.packLitres) fill.packLitres = profile.packLitres;
  }
  return fill;
}
