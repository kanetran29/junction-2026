// Copies the demo page and only what it loads into dist/assets/demo/, the Workers static assets directory, so /demo/ serves
// it: the top-level page files (.html, .css, .mjs, .json) and the kit/, fixtures/ and assets/ folders. Notes (.md), dev/,
// test/, shots/ and story.mp4 stay unpublished.
import { cpSync, readdirSync, rmSync } from 'node:fs';

const OUT = 'dist/assets';
const PAGE = [...readdirSync('demo').filter((f) => /\.(html|css|mjs|json)$/.test(f)), 'kit', 'fixtures', 'assets'];

rmSync(OUT, { recursive: true, force: true });
for (const p of PAGE) cpSync(`demo/${p}`, `${OUT}/demo/${p}`, { recursive: true });
