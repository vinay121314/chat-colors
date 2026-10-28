// Loads the BUILT extension (dist/) into Chromium and runs it against a static fixture served at
// https://chatgpt.com via request interception. This proves extension wiring, not live-site compatibility.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';

const DIST = resolve('dist');
const FIXTURE = readFileSync(resolve('tests/fixtures/chatgpt.html'), 'utf8');
const SHOTS = resolve('docs/screenshots');
const ID = {
  ts: '11111111-1111-4111-8111-111111111111',
  meeting: '22222222-2222-4222-8222-222222222222',
  plain: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
};
/** Expected computed box-shadow fragment: "#rrggbb <thickness>px inset" in normalised form. */
const rgb = (hex: string) => hex.toLowerCase();

const test = base.extend<{ context: BrowserContext; extId: string }>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    await context.route('https://chatgpt.com/**', (r) => r.fulfill({ contentType: 'text/html', body: FIXTURE }));
    await use(context);
    await context.close();
  },
  extId: async ({ context }, use) => {
    // No service worker to read the id from, so ask chrome://extensions.
    const p = await context.newPage();
    await p.goto('chrome://extensions');
    const id = await p.evaluate(
      () =>
        document
          .querySelector('extensions-manager')!
          .shadowRoot!.querySelector('extensions-item-list')!
          .shadowRoot!.querySelector('extensions-item')!.id,
    );
    await p.close();
    await use(id);
  },
});

async function openChat(context: BrowserContext, path = `/c/${ID.ts}`): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`https://chatgpt.com${path}`);
  await p.locator('#ds-sidebar a[data-crc]').first().waitFor({ state: 'attached' });
  return p;
}
const rowLoc = (p: Page, id: string) => p.locator(`#ds-sidebar a[data-crc="${id}"]`);
// Computed box-shadow, with the color normalised to #rrggbb (Chromium reports color-mix() as "color(srgb r g b)").
const shadowOf = (p: Page, id: string) =>
  rowLoc(p, id).evaluate((a) => {
    const s = getComputedStyle(a).boxShadow;
    const hex = (n: number[]) => '#' + n.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return s
      .replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)\)/, (_, r, g, b) => hex([r, g, b].map((v: string) => +v * 255)))
      .replace(/rgba?\((\d+), (\d+), (\d+)\)/, (_, r, g, b) => hex([+r, +g, +b]));
  });
const openPopup = async (context: BrowserContext, extId: string) => {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  await p.locator('#categories li').first().waitFor();
  return p;
};
const stored = (popup: Page) =>
  popup.evaluate(async () => (await chrome.storage.local.get('crc:settings'))['crc:settings'] as { overrides: Record<string, string> } | undefined);

test('colors rows by keyword rules, ignores non-conversation links, no layout shift', async ({ context, extId }) => {
  const p = await openChat(context);
  expect(await shadowOf(p, ID.ts)).toContain(rgb('#2f7de1')); // Development
  expect(await shadowOf(p, ID.meeting)).toContain(rgb('#16a34a')); // Work
  expect(await shadowOf(p, ID.project)).toContain(rgb('#e03131')); // Project URL, "urgent"
  expect(await p.locator('nav[aria-label="Sidebar"] [data-crc]').count()).toBe(0);

  const rects = () => p.locator('#list a').evaluateAll((as) => as.map((a) => JSON.stringify(a.getBoundingClientRect())));
  const before = await rects();
  const popup = await openPopup(context, extId);
  await popup.locator('#enabled').uncheck();
  await expect(p.locator('[data-crc]')).toHaveCount(0);
  expect(await rects()).toEqual(before); // decoration did not move or resize any row
  await popup.locator('#enabled').check();
  await expect(rowLoc(p, ID.ts)).toHaveAttribute('data-crc-color', '');
});

test('in-row control: no navigation, manual color persists across reload and rename', async ({ context, extId }) => {
  const p = await openChat(context);
  const row = rowLoc(p, ID.plain);
  await row.hover();
  await row.locator('.crc-btn').click();
  expect(await p.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(0);
  expect(p.url()).toContain(ID.ts);

  const picker = p.locator('#crc-picker-host [popover]');
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Urgent' }).click();
  await expect(picker).toBeHidden();
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#e03131'));

  const popup = await openPopup(context, extId);
  expect((await stored(popup))?.overrides[ID.plain]).toBe('#e03131');

  await p.reload();
  await rowLoc(p, ID.plain).waitFor({ state: 'attached' });
  expect(await shadowOf(p, ID.plain)).toContain(rgb('#e03131'));

  // Rename: manual stays; an auto row reclassifies.
  await p.evaluate(
    ([a, b]) => {
      document.querySelector(`a[data-crc="${a}"] .truncate`)!.textContent = 'python stuff';
      document.querySelector(`a[data-crc="${b}"] .truncate`)!.textContent = 'python stuff';
    },
    [ID.plain, ID.meeting],
  );
  await expect.poll(() => shadowOf(p, ID.meeting)).toContain(rgb('#2f7de1'));
  expect(await shadowOf(p, ID.plain)).toContain(rgb('#e03131'));

  // Custom HEX, Remove, Reset.
  await row.hover();
  await row.locator('.crc-btn').click();
  await picker.getByRole('textbox', { name: 'Custom HEX color' }).fill('#abc');
  await picker.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#aabbcc'));
  await row.hover();
  await row.locator('.crc-btn').click();
  await picker.getByRole('button', { name: 'Remove color' }).click();
  await expect(row).not.toHaveAttribute('data-crc-color');
  await row.hover();
  await row.locator('.crc-btn').click();
  await picker.getByRole('button', { name: 'Reset to automatic' }).click();
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#2f7de1')); // title is now "python stuff"
});

test('rejects invalid custom HEX', async ({ context }) => {
  const p = await openChat(context);
  const row = rowLoc(p, ID.plain);
  await row.hover();
  await row.locator('.crc-btn').click();
  const picker = p.locator('#crc-picker-host [popover]');
  await picker.getByRole('textbox', { name: 'Custom HEX color' }).fill('not-a-color');
  await picker.getByRole('button', { name: 'Apply' }).click();
  await expect(picker).toBeVisible();
  expect(await shadowOf(p, ID.plain)).toContain(rgb('#8a8a8a')); // unchanged fallback
});

test('keyboard: Tab to control, Enter opens, Escape closes and returns focus', async ({ context }) => {
  const p = await openChat(context);
  await rowLoc(p, ID.meeting).focus();
  // Native order is kept: row link -> ChatGPT's own row menu button -> our control.
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement?.className)).toBe('opts');
  await p.keyboard.press('Tab');
  expect(await p.evaluate(() => document.activeElement?.className)).toBe('crc-btn');
  await p.keyboard.press('Enter');
  const picker = p.locator('#crc-picker-host [popover]');
  await expect(picker).toBeVisible();
  expect(await p.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(0);
  await p.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  expect(await p.evaluate(() => document.activeElement?.className)).toBe('crc-btn');
});

test('multiple ChatGPT tabs update live', async ({ context, extId }) => {
  const a = await openChat(context);
  const b = await openChat(context, `/c/${ID.meeting}`);
  const popup = await openPopup(context, extId);
  await popup.evaluate(async (id) => {
    const s = ((await chrome.storage.local.get('crc:settings'))['crc:settings'] ?? { version: 1 }) as {
      overrides?: Record<string, string>;
    };
    s.overrides = { ...(s.overrides ?? {}), [id]: '#d6336c' };
    await chrome.storage.local.set({ 'crc:settings': s });
  }, ID.ts);
  for (const p of [a, b]) await expect.poll(() => shadowOf(p, ID.ts)).toContain(rgb('#d6336c'));
});

test('popup <-> content messaging works without the tabs permission', async ({ context, extId }) => {
  await openChat(context, `/c/${ID.meeting}`);
  const popup = await openPopup(context, extId);
  const res = await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    const replies = await Promise.all(
      tabs.map(async (t) => {
        const r = await chrome.tabs.sendMessage(t.id!, { type: 'crc:current' }).catch(() => null);
        return r && { r, url: t.url, title: t.title };
      }),
    );
    const hits = replies.filter(Boolean);
    // The extension can see its own pages' URLs, but not the ChatGPT tab's (no tabs/host permission).
    return { urlsVisible: hits.some((h) => h!.url !== undefined || h!.title !== undefined), replies: hits.map((h) => h!.r) };
  });
  expect(res.urlsVisible).toBe(false);
  expect(res.replies).toEqual([{ id: ID.meeting, title: 'Client meeting notes' }]);
});

test('popup: categories, rules, preview, priority, appearance, import/export', async ({ context, extId }) => {
  const p = await openChat(context);
  const popup = await openPopup(context, extId);
  popup.on('dialog', (d) => d.accept());

  await popup.locator('#test-title').fill('Weekly CLIENT sync');
  await expect(popup.locator('#test-result')).toHaveText('Matches: Work');

  const addPersonal = popup.getByRole('textbox', { name: 'Add keyword to Personal' });
  await addPersonal.fill('hello, greetings');
  await addPersonal.press('Enter');
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#e8590c'));
  await popup.locator('#categories > li', { hasText: 'greetings' }).getByRole('checkbox', { name: 'hello' }).uncheck();
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#8a8a8a'));

  // Priority: "Urgent launch checklist" matches Work (above Urgent) once 'launch' is added; then move Urgent up.
  const addWork = popup.getByRole('textbox', { name: 'Add keyword to Work' });
  await addWork.fill('launch');
  await addWork.press('Enter');
  await expect.poll(() => shadowOf(p, ID.project)).toContain(rgb('#16a34a'));
  const up = popup.getByRole('button', { name: 'Move Urgent up' });
  while (!(await up.isDisabled())) await up.click();
  await expect.poll(() => shadowOf(p, ID.project)).toContain(rgb('#e03131'));

  await popup.locator('#thickness').fill('2');
  await expect.poll(() => shadowOf(p, ID.ts)).toMatch(/inset 2px|2px 0px 0px 0px inset/);

  const [download] = await Promise.all([popup.waitForEvent('download'), popup.locator('#export').click()]);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(exported.version).toBe(1);
  expect(exported.appearance.thickness).toBe(2);

  await popup.locator('#import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(popup.locator('#io-status')).toContainText('Import failed');
  exported.appearance.thickness = 6;
  await popup.locator('#import').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(popup.locator('#io-status')).toHaveText('Imported.');
  await expect.poll(() => shadowOf(p, ID.ts)).toMatch(/inset 6px|6px 0px 0px 0px inset/);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} theme: popup themed, borders visible (screenshots)`, async ({ context, extId }) => {
    const p = await openChat(context);
    await p.emulateMedia({ colorScheme: scheme });
    await p.setViewportSize({ width: 900, height: 420 });
    expect(await shadowOf(p, ID.ts)).toContain(rgb('#2f7de1'));
    await rowLoc(p, ID.meeting).hover();
    await p.locator('#ds-sidebar').screenshot({ path: `${SHOTS}/fixture-sidebar-${scheme}.png` });

    const popup = await openPopup(context, extId);
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 360, height: 900 });
    const bg = await popup.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === 'dark' ? 'rgb(23, 24, 27)' : 'rgb(255, 255, 255)');
    await popup.screenshot({ path: `${SHOTS}/popup-${scheme}.png`, fullPage: true });
  });
}
