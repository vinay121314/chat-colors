// Regression suite for the VERIFIED logged-in sidebar structure (see tests/fixtures/chatgpt-live.html).
// Still a fixture: proves behaviour against the reported DOM shape, not against chatgpt.com itself.
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './harness';

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
    await expect(item(p, id).locator(':scope > .crc-btn')).toHaveCount(1);
    await expect(item(p, id).locator(':scope > .crc-bar')).toHaveCount(1); // seeded: rules + neutral fallback
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

test('native three-dot menu still works, and our dot does not overlap it', async ({ context }) => {
  const p = await openChat(context);
  const row = item(p, ID.ts);
  await row.hover();
  const menu = row.locator('button.menu');
  const dot = row.locator(':scope > .crc-btn');
  const [m, d] = [(await menu.boundingBox())!, (await dot.boundingBox())!];
  expect(d.x + d.width).toBeLessThanOrEqual(m.x); // dot sits to the left of the native menu
  await menu.click();
  expect(await p.evaluate(() => (window as unknown as { __menu: number }).__menu)).toBe(1);
  expect(await p.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(0);
});

test('our picker opens without navigating; the row link still navigates normally', async ({ context }) => {
  const p = await openChat(context);
  const row = item(p, ID.plain);
  await row.hover();
  await row.locator(':scope > .crc-btn').click();
  await expect(p.locator('#crc-picker-host [popover]')).toBeVisible();
  expect(await p.evaluate(() => (window as unknown as { __navigations: number }).__navigations)).toBe(0);
  await p.keyboard.press('Escape');
  await row.locator('a').click();
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
