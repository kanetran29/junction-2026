// Copies the demo page and only the files it loads into dist/assets/demo/, the Workers static assets directory, so /demo/
// serves it. Everything else in demo/ (dev/, test/, shots/, SCRIPT.md, STATUS.md, story.mp4) stays unpublished.
import { cpSync, rmSync } from 'node:fs';

const OUT = 'dist/assets';
const PAGE = ['index.html', 'demo.css', 'main.mjs', 'model.mjs', 'story.mjs', 'live.mjs', 'scene.mjs', 'compare.mjs', 'icons.mjs', 'inside.mjs', 'inside-view.mjs', 'try.mjs', 'try-view.mjs', 'proof.json', 'kit', 'fixtures', 'assets'];

rmSync(OUT, { recursive: true, force: true });
for (const p of PAGE) cpSync(`demo/${p}`, `${OUT}/demo/${p}`, { recursive: true });
