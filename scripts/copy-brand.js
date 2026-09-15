// Brand assets are plain files, not code: tsup bundles TypeScript, so copy them next to the bundle.
import fs from 'node:fs';
import path from 'node:path';

const from = path.resolve('brand');
const to = path.resolve('dist/brand');
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
let n = 0;
for (const entry of fs.readdirSync(from)) {
  if (entry === 'README.md') continue;
  fs.copyFileSync(path.join(from, entry), path.join(to, entry));
  n += 1;
}
console.log(`dist/brand: ${n} files`);
