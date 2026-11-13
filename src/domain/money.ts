/**
 * Rounds a non-negative number half up (2.5 -> 3); JS Math.round and Python round() differ on halves, and every
 * cent amount in the gateway must match the independent oracle, which rounds half up.
 */
export function halfUp(x: number): number {
  return Math.floor(x + 0.5);
}

/**
 * Net cents of one order line: the unit price in cents (half up) times the sales units, half up again.
 * Rounding the unit price first matches how the oracle prices a line, so quote and order totals agree to the cent.
 */
export function lineNetCents(unitPrice: number, salesUnits: number): number {
  return halfUp(halfUp(unitPrice * 100) * salesUnits);
}
