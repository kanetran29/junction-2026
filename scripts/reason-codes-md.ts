import { writeFileSync } from 'node:fs';
import { REASONS } from '../src/domain/reasons';

/**
 * Renders the reason-code table of `src/domain/reasons.ts` as `docs/reason-codes.md`, so the document is generated
 * from the same table `GET /v1/reason-codes` serves and cannot drift from it.
 */
function render(): string {
  const rows = Object.entries(REASONS).map(([code, r]) => `| \`${code}\` | ${r.text} | \`${r.resolution}\` | ${r.retryable ? 'yes' : 'no'} |`);
  return [
    '# Reason codes',
    '',
    'Generated from `src/domain/reasons.ts` by `scripts/reason-codes-md.ts`. Do not edit by hand.',
    'The same table is served live at `GET /v1/reason-codes`.',
    '',
    '- `recoverable`: the same call may work if repeated, or after a new quote.',
    '- `requires_buyer_input`: the buyer must change the request.',
    '- `requires_buyer_review`: a human must look before the order goes ahead.',
    '- Retryable: whether the same request may succeed if sent again.',
    '',
    '| Code | Text | Resolution | Retryable |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

writeFileSync(new URL('../docs/reason-codes.md', import.meta.url), render());
