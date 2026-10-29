// Regression suite for the VERIFIED logged-in sidebar structure (see tests/fixtures/chatgpt-live.html).
// Still a fixture: proves behaviour against the reported DOM shape, not against chatgpt.com itself.
import type { BrowserContext, Page } from '@playwright/test';
import { SHOTS, expect, test } from './harness';

test.use({ fixturePage: 'tests/fixtures/chatgpt-live.html' });

const ID = {
  ts: '11111111-1111-4111-8111-111111111111',
  meeting: '22222222-2222-4222-8222-222222222222',
  plain: '44444444-4444-4444-8444-444444444444',
  project: '55555555-5555-4555-8555-555555555555',
};
const ROOT = 'aside[data-app-shell-left-panel-appearance]';
const item = (p: Page, id: string) => p.locator(`${ROOT} [role="listitem"][data-crc="${id}"]`);

async function openChat(context: BrowserContext, path = `/c/${ID.meeting}`): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`https://chatgpt.com${path}`);
  await p.locator(`${ROOT} [data-crc]`).first().waitFor({ state: 'attached' });
  return p;
}

test('decorates the listitem wrapper (not the link), only in the sidebar, no duplicates', async ({ context }) => {
  const p = await openChat(context);
  await expect(p.locator(`${ROOT} [role="listitem"][data-crc]`)).toHaveCount(5);
  await expect(p.locator(`${ROOT} a[data-crc]`)).toHaveCount(0);
  await expect(p.locator('main [data-crc]')).toHaveCount(0);
  for (const id of Object.values(ID)) {
    await expect(item(p, id).locator(':scope > .crc-bar')).toHaveCount(1); // seeded: rules + neutral fallback
    // Nothing interactive of ours in the row: only ChatGPT's own link and menu button remain.
    await expect(item(p, id).locator('button, [role="button"], [tabindex]')).toHaveCount(1);
    await expect(item(p, id).locator('.crc-btn, .crc-open')).toHaveCount(0);
  }
});

test('no layout shift: listitem and link boxes are identical with decoration on and off', async ({ context, extId }) => {
  const p = await openChat(context);
  const boxes = () =>
    p.locator(`${ROOT} [role="listitem"]`).evaluateAll((els) =>
      els.map((e) => JSON.stringify([e.getBoundingClientRect(), e.querySelector('a')!.getBoundingClientRect()])),
    );
  const on = await boxes();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.locator('#enabled').uncheck();
  await p.bringToFront();
  await expect(p.locator(`${ROOT} [data-crc]`)).toHaveCount(0);
  expect(await boxes()).toEqual(on);
});

test('native three-dot menu: nothing of ours overlaps or intercepts it, in every style mode', async ({ context, extId }) => {
  const p = await openChat(context);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  for (const mode of ['bar', 'both', 'fill'] as const) {
    await popup.evaluate(async (m) => {
      const s = (await chrome.storage.local.get('crc:settings'))['crc:settings'] as { appearance: Record<string, unknown> };
      await chrome.storage.local.set({ 'crc:settings': { ...s, appearance: { ...s.appearance, mode: m } } });
    }, mode);
    await p.bringToFront();
    const row = item(p, ID.ts);
    await row.hover();
    // The element on top at the menu's center must be the menu itself.
    const topAtMenu = await row.locator('button.menu').evaluate((m) => {
      const r = m.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === m;
    });
    expect(topAtMenu, `mode=${mode}`).toBe(true);
    // Our elements never take pointer events.
    const ours = await row.evaluate((r) => [...r.querySelectorAll('.crc-bar, .crc-fill')].map((e) => getComputedStyle(e).pointerEvents));
    expect(ours.every((v) => v === 'none'), `mode=${mode}`).toBe(true);
  }
  const before = await p.evaluate(() => (window as unknown as { __menu: number }).__menu);
  await item(p, ID.ts).locator('button.menu').click();
  expect(await p.evaluate(() => (window as unknown as { __menu: number }).__menu)).toBe(before + 1);
  expect(await p.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(0);
});

test('the row link still navigates normally with decoration', async ({ context }) => {
  const p = await openChat(context);
  await item(p, ID.plain).locator('a').click();
  expect(await p.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(1);
  expect(p.url()).toContain(ID.plain);
});

test('bar is drawn at the listitem edge, before the title text', async ({ context }) => {
  const p = await openChat(context);
  const g = await item(p, ID.ts).evaluate((r) => {
    const bar = r.querySelector(':scope > .crc-bar')!.getBoundingClientRect();
    const text = r.querySelector('.truncate')!.getBoundingClientRect();
    return { barR: bar.right, textL: text.left, barH: bar.height, rowH: r.getBoundingClientRect().height };
  });
  expect(g.barR).toBeLessThanOrEqual(g.textL);
  expect(g.barH).toBeGreaterThan(g.rowH * 0.5);
});


// ---------------------------------------------------------------- Feature 5: open-chat highlight

const outlined = (p: Page) =>
  p.locator(`${ROOT} [data-crc-active]`).evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute('data-crc'), outline: getComputedStyle(e).outlineStyle + ' ' + getComputedStyle(e).outlineWidth })),
  );

test('highlights the open chat, keeps its color, and follows SPA navigation and back/forward', async ({ context }) => {
  const p = await openChat(context, `/c/${ID.meeting}`);
  await expect.poll(() => outlined(p)).toEqual([{ id: ID.meeting, outline: 'solid 2px' }]);
  await expect(item(p, ID.meeting).locator(':scope > .crc-bar')).toHaveCount(1); // color preserved
  for (const scheme of ['light', 'dark'] as const) {
    await p.emulateMedia({ colorScheme: scheme });
    await p.locator(ROOT).screenshot({ path: `${SHOTS}/highlight-${scheme}.png` });
  }

  await item(p, ID.ts).locator('a').click(); // SPA navigation, ChatGPT moves aria-current
  await expect.poll(() => outlined(p)).toEqual([{ id: ID.ts, outline: 'solid 2px' }]);

  await p.goBack(); // popstate
  await expect.poll(() => outlined(p)).toEqual([{ id: ID.meeting, outline: 'solid 2px' }]);
  await p.goForward();
  await expect.poll(() => outlined(p)).toEqual([{ id: ID.ts, outline: 'solid 2px' }]);
});

test('highlight shows on an uncolored chat too, and can be switched off independently', async ({ context, extId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.evaluate(async () => {
    const s = (await chrome.storage.local.get('crc:settings'))['crc:settings'] as Record<string, unknown>;
    await chrome.storage.local.set({ 'crc:settings': { ...s, fallback: 'none' } });
  });
  const p = await openChat(context, `/c/${ID.plain}`);
  await expect(item(p, ID.plain).locator(':scope > .crc-bar')).toHaveCount(0); // uncolored
  await expect.poll(() => outlined(p)).toEqual([{ id: ID.plain, outline: 'solid 2px' }]);

  await popup.bringToFront();
  await popup.getByRole('tab', { name: 'Style' }).click();
  await popup.getByRole('switch', { name: 'Outline the open chat' }).uncheck();
  await p.bringToFront();
  await expect.poll(() => outlined(p)).toEqual([]);
});

test('outline is customizable: preset color, HEX, width, opacity, Auto, and off; bar color kept', async ({ context, extId }) => {
  const p = await openChat(context, `/c/${ID.meeting}`);
  const outline = () =>
    item(p, ID.meeting).evaluate((e) => {
      const cs = getComputedStyle(e);
      return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
  expect(await outline()).toMatchObject({ style: 'solid', width: '2px' });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.getByRole('tab', { name: 'Style' }).click();
  await popup.getByRole('button', { name: 'Outline #e03131' }).click();
  await popup.locator('#outlineWidth').fill('4');
  await popup.locator('#outlineOpacity').fill('100');
  await p.bringToFront();
  await expect.poll(outline).toMatchObject({ style: 'solid', width: '4px' });
  expect((await outline()).color).toMatch(/224, 49, 49|0\.878.*0\.192.*0\.192/); // #e03131 at 100%
  await expect(item(p, ID.meeting).locator(':scope > .crc-bar')).toHaveCount(1); // assigned color preserved

  await popup.bringToFront();
  await popup.locator('#outline-hex').fill('#00ff00');
  await popup.locator('#outline-apply').click();
  await p.bringToFront();
  await expect.poll(async () => (await outline()).color).toMatch(/0, 255, 0|0 1 0/);

  await popup.bringToFront();
  await popup.getByRole('button', { name: 'Auto outline color (text color)' }).click();
  await popup.screenshot({ path: `${SHOTS}/popup-style-outline.png` });
  await popup.getByRole('switch', { name: 'Outline the open chat' }).uncheck();
  await p.bringToFront();
  await expect.poll(async () => (await outline()).style).toBe('none');
});

test('invalid outline HEX is rejected; empty means Auto', async ({ context, extId }) => {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.getByRole('tab', { name: 'Style' }).click();
  await popup.locator('#outline-hex').fill('nope');
  await popup.locator('#outline-apply').click();
  const saved = () =>
    popup.evaluate(async () => ((await chrome.storage.local.get('crc:settings'))['crc:settings'] as { appearance: { outlineColor: string } }).appearance.outlineColor);
  expect(await saved()).toBe('auto');
  await popup.locator('#outline-hex').fill('#123');
  await popup.locator('#outline-apply').click();
  await expect.poll(saved).toBe('#112233');
  await popup.locator('#outline-hex').fill('');
  await popup.locator('#outline-apply').click();
  await expect.poll(saved).toBe('auto');
});