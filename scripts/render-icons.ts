// Renders assets/icon.svg to public/icons/icon-<size>.png with the project's Playwright Chromium.
// Run after editing the SVG: `node scripts/render-icons.ts`. The PNGs are committed; the build doesn't run this.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= r('.pw-browsers'); // read at import time, hence the dynamic import
const { chromium } = await import('@playwright/test');

const svg = readFileSync(r('assets/icon.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: r(`public/icons/icon-${size}.png`), omitBackground: true });
}
await browser.close();
