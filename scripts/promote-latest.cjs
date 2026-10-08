// Promotes this host's unpacked output, replacing any existing release/latest.
const { rmSync, renameSync, existsSync } = require('fs');
const { join } = require('path');
const { desktopTarget } = require('./desktop-targets.mjs');

const root = join(__dirname, '..');
const src = join(root, 'release', desktopTarget().asarSegments[0]);
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
