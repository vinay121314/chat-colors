// Feature 2 in a real Chromium with the built extension (real service worker, real tabs/windows APIs,
// manifest permissions = ["storage"] only). Pages are the live-structure fixture served at chatgpt.com.
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { SHOTS, expect, test } from './harness';

test.use({ fixturePage: 'tests/fixtures/chatgpt-live.html' });

const A = '22222222-2222-4222-8222-222222222222'; // "Client meeting notes"
const B = '11111111-1111-4111-8111-111111111111'; // "Fix TypeScript bug in parser"
const ROOT = 'aside[data-app-shell-left-panel-appearance]';
const badge = (p: Page, id: string) => p.locator(`${ROOT} [data-crc="${id}"] > .crc-open`);

async function worker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
}
async function openChat(context: BrowserContext, id: string): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`https://chatgpt.com/c/${id}`);
  await p.locator(`${ROOT} [data-crc]`).first().waitFor({ state: 'attached' });
  return p;
}
/** The worker's session map: tabId -> conversation id. */
const openMap = async (sw: Worker) =>
  sw.evaluate(async () => ((await chrome.storage.session.get('crc:open'))['crc:open'] ?? {}) as Record<string, string | null>);
const tabOf = async (sw: Worker, id: string) => Number(Object.entries(await openMap(sw)).find(([, v]) => v === id)?.[0]);

test('manifest still requests only "storage"; worker never gets tab URLs', async ({ context }) => {
  const sw = await worker(context);
  const m = await sw.evaluate(() => chrome.runtime.getManifest());
  expect(m.permissions).toEqual(['storage']);
  expect(m.host_permissions).toBeUndefined();
  await openChat(context, A);
  const tabs = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ url: t.url, title: t.title })));
  // Proves the platform withholds URL/title from us (we never call query in the extension itself).
  for (const t of tabs) {
    expect(t.url).toBeUndefined();
    expect(t.title).toBeUndefined();
  }
});

test('marks chats open in another tab; badge switches to that tab instead of opening a duplicate', async ({ context }) => {
  const sw = await worker(context);
  const pa = await openChat(context, A);
  const pb = await openChat(context, B);
  await pa.bringToFront();
  await expect(badge(pa, B)).toHaveCount(1); // B is open in tab pb
  await expect(badge(pa, A)).toHaveCount(0); // A is only open here
  await expect(badge(pb, A)).toHaveCount(1);
  await pa.locator(ROOT).screenshot({ path: `${SHOTS}/open-in-other-tab.png` });

  const tabB = await tabOf(sw, B);
  const pagesBefore = context.pages().length;
  await badge(pa, B).click();
  await expect.poll(() => sw.evaluate(async (t) => (await chrome.tabs.get(t)).active, tabB)).toBe(true);
  expect(context.pages().length).toBe(pagesBefore); // no new tab
  expect(await pa.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(0);
});

test('tab activation and window focusing work with only the "storage" permission (real APIs)', async ({ context }) => {
  const sw = await worker(context);
  await openChat(context, A);
  // Second window (windows.create needs no permission either).
  await Promise.all([
    context.waitForEvent('page'),
    sw.evaluate(() => chrome.windows.create({ url: 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111' })),
  ]);
  await expect.poll(() => tabOf(sw, B)).toBeGreaterThan(0); // its content script reported in
  const tabC = await tabOf(sw, B);
  const result = await sw.evaluate(async (t) => {
    const tab = await chrome.tabs.update(t, { active: true });
    const win = await chrome.windows.update(tab!.windowId, { focused: true });
    return { tabActive: tab!.active, windowId: win.id === tab!.windowId, error: chrome.runtime.lastError?.message ?? null };
  }, tabC);
  expect(result).toEqual({ tabActive: true, windowId: true, error: null });
});

test('switching across windows via the badge', async ({ context }) => {
  const sw = await worker(context);
  const pa = await openChat(context, A);
  await Promise.all([
    context.waitForEvent('page'),
    sw.evaluate(() => chrome.windows.create({ url: 'https://chatgpt.com/c/11111111-1111-4111-8111-111111111111' })),
  ]);
  await expect.poll(() => tabOf(sw, B)).toBeGreaterThan(0);
  const tabC = await tabOf(sw, B);
  const winC = await sw.evaluate(async (t) => (await chrome.tabs.get(t)).windowId, tabC);
  await pa.bringToFront();
  await expect(badge(pa, B)).toHaveCount(1);
  await badge(pa, B).click();
  await expect.poll(() => sw.evaluate(async (t) => (await chrome.tabs.get(t)).active, tabC)).toBe(true);
  // Window focus is OS/headless dependent; the call succeeding is verified above. Report what we see.
  const focused = await sw.evaluate(async () => (await chrome.windows.getLastFocused()).id);
  test.info().annotations.push({ type: 'window-focus', description: `lastFocused=${focused} target=${winC}` });
});

test('tab closure and navigation update the indicator', async ({ context }) => {
  await worker(context);
  const pa = await openChat(context, A);
  const pb = await openChat(context, B);
  await expect(badge(pa, B)).toHaveCount(1);

  // In-app navigation in tab B: B -> the "Hello there" chat.
  const H = '44444444-4444-4444-8444-444444444444';
  await pb.locator(`${ROOT} a[href="/c/${H}"]`).click();
  await expect(badge(pa, H)).toHaveCount(1);
  await expect(badge(pa, B)).toHaveCount(0);

  // Leaving ChatGPT (pagehide) clears it.
  await pb.goto('about:blank');
  await expect(badge(pa, H)).toHaveCount(0);

  // Closing a tab clears it.
  const pc = await openChat(context, B);
  await expect(badge(pa, B)).toHaveCount(1);
  await pc.close();
  await expect(badge(pa, B)).toHaveCount(0);
});

test('survives the service worker being stopped (state in storage.session)', async ({ context }) => {
  const sw = await worker(context);
  const pa = await openChat(context, A);
  await openChat(context, B);
  await expect(badge(pa, B)).toHaveCount(1);
  const tabB = await tabOf(sw, B);

  const cdp = await context.newCDPSession(pa);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');

  await pa.bringToFront();
  await badge(pa, B).click(); // message wakes a fresh worker, which reads the session map
  const sw2 = await worker(context);
  await expect.poll(() => sw2.evaluate(async (t) => (await chrome.tabs.get(t)).active, tabB)).toBe(true);
});

test('can be switched off: no badge, and the tab stops reporting', async ({ context, extId }) => {
  const sw = await worker(context);
  const pa = await openChat(context, A);
  await openChat(context, B);
  await expect(badge(pa, B)).toHaveCount(1);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.getByRole('tab', { name: 'Style' }).click();
  await popup.getByRole('switch', { name: 'Mark chats open in another tab' }).uncheck();
  await expect(badge(pa, B)).toHaveCount(0);
  await expect.poll(async () => Object.values(await openMap(sw)).filter(Boolean)).toEqual([]);
});
