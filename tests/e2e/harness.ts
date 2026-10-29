// Shared Playwright harness: launches Chromium with the BUILT extension (dist/) and serves a static
// fixture page at https://chatgpt.com via request interception. Proves extension wiring against the
// fixture's DOM, not live-site compatibility.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import { NEUTRAL, addStarterKeywords, defaultSettings } from '../../src/core/schema';

export { expect } from '@playwright/test';
export const DIST = resolve('dist');
export const SHOTS = resolve('docs/screenshots');

/** Opt-in suggested keywords + neutral fallback (auto-coloring is off by default since v2). */
export const SEEDED = { ...addStarterKeywords(defaultSettings()), fallback: NEUTRAL };

export const test = base.extend<{ context: BrowserContext; extId: string; seed: boolean; fixturePage: string }>({
  /** true = store SEEDED before any ChatGPT tab opens; false = fresh install. */
  seed: [true, { option: true }],
  /** Which fixture to serve at https://chatgpt.com/**. */
  fixturePage: ['tests/fixtures/chatgpt.html', { option: true }],
  context: async ({ fixturePage }, use) => {
    const body = readFileSync(resolve(fixturePage), 'utf8');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await context.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body }));
    await use(context);
    await context.close();
  },
  extId: [
    async ({ context, seed }, use) => {
      // Read the id from chrome://extensions (works with or without a service worker).
      const p = await context.newPage();
      await p.goto('chrome://extensions');
      const id = await p.evaluate(
        () =>
          document
            .querySelector('extensions-manager')!
            .shadowRoot!.querySelector('extensions-item-list')!
            .shadowRoot!.querySelector('extensions-item')!.id,
      );
      if (seed) {
        await p.goto(`chrome-extension://${id}/popup.html`);
        await p.evaluate((s) => chrome.storage.local.set({ 'crc:settings': s }), SEEDED);
      }
      await p.close();
      await use(id);
    },
    { auto: true },
  ],
});


/**
 * Popup opened as a tab, with "active tab" resolved to the ChatGPT tab. Test-only: a real action
 * popup's active tab IS the ChatGPT tab; a popup opened as a tab can't reproduce that.
 */
export async function openPopupForChat(context: BrowserContext, extId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) => {
      const all = await query({});
      if (!info.active) return all;
      for (const t of all) if (await chrome.tabs.sendMessage(t.id!, { type: 'crc:current' }).catch(() => null)) return [t];
      return [];
    }) as typeof chrome.tabs.query;
  });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.locator('#categories li').first().waitFor({ state: 'attached' });
  return popup;
}