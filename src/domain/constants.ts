/** The audience every mandate is signed for; one constant for dev and deployed so no request origin is trusted. */
export const MANDATE_AUD = 'lazydoor';

/** A buyer's signed spending/safety limits that bound what the purchasing agent may do (money in cents). */
export interface Mandate {
  buyerId: string;
  version: number;
  perOrder: { autoCents: number; hardCents: number };
  perDay: { autoCents: number; hardCents: number };
  noNewAllergen: boolean;
  reliabilityFloor: number;
  reliabilityUnknown: 'allow' | 'approve';
  approver: { name: string };
  exp: string;
  aud: string;
}

/** The mandate expiry used for the event: the end of 2026-11-15 Helsinki time. */
export const DEFAULT_MANDATE_EXP = '2026-11-16T00:00:00+02:00';

/**
 * The seeded default mandate for a buyer (published by `/v1/rules`): auto-approve up to 500 EUR per order and
 * per day, hard-stop at 5000 EUR per order and 10000 EUR per day, 0.9 reliability floor, unknown reliability allowed.
 */
export function defaultMandate(buyerId: string): Mandate {
  return {
    buyerId,
    version: 1,
    perOrder: { autoCents: 50000, hardCents: 500000 },
    perDay: { autoCents: 50000, hardCents: 1000000 },
    noNewAllergen: true,
    reliabilityFloor: 0.9,
    reliabilityUnknown: 'allow',
    approver: { name: 'Kitchen manager' },
    exp: DEFAULT_MANDATE_EXP,
    aud: MANDATE_AUD,
  };
}
