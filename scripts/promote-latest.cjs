// Renames release/win-unpacked → release/latest, replacing any existing release/latest.
// Run after `electron-builder --dir` which always emits release/win-unpacked.
const { rmSync, renameSync, existsSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..');
const src = join(root, 'release', 'win-unpacked');
const dst = join(root, 'release', 'latest');

if (!existsSync(src)) {
  console.error(`[promote-latest] ${src} does not exist — did electron-builder run?`);
  process.exit(1);
}
if (existsSync(dst)) {
  rmSync(dst, { recursive: true, force: true });
}
renameSync(src, dst);
console.log(`[promote-latest] ${dst}`);
