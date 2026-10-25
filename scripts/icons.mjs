// Render icons/icon.svg to the PNG sizes the manifest uses.
//   node scripts/icons.mjs [path/to/chrome]
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const svg = readFileSync('icons/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: process.argv[2] });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: `icons/icon-${size}.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
