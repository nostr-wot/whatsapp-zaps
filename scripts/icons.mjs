// Render icons/icon.svg (48, 128) and icons/icon-small.svg (16, 32) to the PNGs the manifest uses.
//   node scripts/icons.mjs [path/to/chrome]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// Small sizes use a simplified drawing: at 16–32 px the bubble turns to mush.
const large = readFileSync('icons/icon.svg', 'utf8');
const small = readFileSync('icons/icon-small.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.argv[2] });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    const svg = size <= 32 ? small : large;
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: `icons/icon-${size}.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
