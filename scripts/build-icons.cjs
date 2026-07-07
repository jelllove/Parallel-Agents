// Build app-icon.png + app-icon.ico from resources/app-icon.svg.
// Run via: node scripts/build-icons.cjs
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SVG = path.join(__dirname, '..', 'resources', 'app-icon.svg');
const OUT_PNG = path.join(__dirname, '..', 'resources', 'app-icon.png');
const OUT_ICO = path.join(__dirname, '..', 'resources', 'app-icon.ico');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const APP_PNG_SIZE = 512;

async function main() {
  const { default: pngToIco } = await import('png-to-ico');
  const svg = fs.readFileSync(SVG);

  await sharp(svg, { density: 384 })
    .resize(APP_PNG_SIZE, APP_PNG_SIZE)
    .png()
    .toFile(OUT_PNG);

  const buffers = [];
  for (const size of ICO_SIZES) {
    const buf = await sharp(svg, { density: Math.max(96, size * 4) })
      .resize(size, size)
      .png()
      .toBuffer();
    buffers.push(buf);
  }
  const ico = await pngToIco(buffers);
  fs.writeFileSync(OUT_ICO, ico);

  console.log('[build-icons] wrote', OUT_PNG, '(' + fs.statSync(OUT_PNG).size + ' bytes)');
  console.log('[build-icons] wrote', OUT_ICO, '(' + fs.statSync(OUT_ICO).size + ' bytes)');
}

main().catch((e) => { console.error(e); process.exit(1); });
