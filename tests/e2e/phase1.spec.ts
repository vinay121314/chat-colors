// Phase 1 (bulk assignment, Working Set, Recently Revisited, Presenter Mode) against the
// VERIFIED live-structure fixture (tests/fixtures/chatgpt-live.html). Fixture-tested, not live-tested.
import type { BrowserContext, Page } from '@playwright/test';
import { SHOTS, expect, openPopupForChat, test } from './harness';

test.use({ fixturePage: 'tests/fixtures/chatgpt-live.html' });

const ID = {
  ts: '11111111-1111-4111-8111-111111111111', // Fix TypeScript bug in parser
  meeting: '22222222-2222-4222-8222-222222222222', // Client meeting notes
  recipe: '33333333-3333-4333-8333-333333333333', // Weeknight recipe ideas
  plain: '44444444-4444-4444-8444-444444444444', // Hello there
  project: '55555555-5555-4555-8555-555555555555', // Urgent launch checklist (Project chat)
};
const ROOT = 'aside[data-app-shell-left-panel-appearance]';
const item = (p: Page, id: string) => p.locator(`${ROOT} [role="listitem"][data-crc="${id}"]`);
const barColor = (p: Page, id: string) =>
  item(p, id).evaluate((r) => {
    const b = r.querySelector(':scope > .crc-bar');
    if (!b || getComputedStyle(b).display === 'none') return 'none';
    const m = getComputedStyle(b).backgroundColor.match(/[\d.]+/g)!.map(Number);
    return '#' + m.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  });
type Stored = { chats: Record<string, { status: string | null; updatedAt: number }> } & Record<string, unknown>;
const settings = (pg: Page) => pg.evaluate(async () => (await chrome.storage.local.get('crc:settings'))['crc:settings'] as Stored);

async function openChat(context: BrowserContext, id = ID.meeting): Promise<Page> {
  const p = await context.newPage();
  await p.goto(`https://chatgpt.com/c/${id}`);
  await p.locator(`${ROOT} [data-crc]`).first().waitFor({ state: 'attached' });
  return p;
}
const chatsTab = async (popup: Page) => {
  await popup.getByRole('tab', { name: 'Chats', exact: true }).click();
  await popup.locator('#chat-list .chat-row').first().waitFor();
};
const sel = (popup: Page, title: string) => popup.getByRole('checkbox', { name: `Select ${title}` });

test('bulk: multi-select, Select all visible (with search), Clear, bulk color/category', async ({ context, extId }) => {
  const p = await openChat(context);
  const popup = await openPopupForChat(context, extId);
  await chatsTab(popup);

  await sel(popup, 'Hello there').check();
  await sel(popup, 'Weeknight recipe ideas').check();
  await expect(popup.locator('.bulk-count')).toHaveText('2 selected');

  // Bulk category: assigns the category's color as a manual color to every selected chat.
  await popup.getByRole('button', { name: 'Color or category for selected chats' }).click();
  await popup.locator('.bulk-editor').getByRole('button', { name: 'Research' }).click();
  await p.bringToFront();
  await expect.poll(() => barColor(p, ID.plain)).toBe('#0e9fb3');
  await expect.poll(() => barColor(p, ID.recipe)).toBe('#0e9fb3');
  expect(await barColor(p, ID.ts)).toBe('#2f7de1'); // unselected chat untouched

  // Bulk custom HEX and Remove color.
  await popup.bringToFront();
  await popup.locator('.bulk-editor').getByRole('textbox', { name: 'Custom HEX color' }).fill('#123456');
  await popup.locator('.bulk-editor').getByRole('button', { name: 'Apply' }).click();
  await p.bringToFront();
  await expect.poll(() => barColor(p, ID.recipe)).toBe('#123456');
  await popup.bringToFront();
  await popup.locator('.bulk-editor').getByRole('button', { name: 'Remove color' }).click();
  await p.bringToFront();
  await expect.poll(() => barColor(p, ID.plain)).toBe('none');

  // Search + Select all visible + Clear.
  await popup.bringToFront();
  await popup.getByRole('button', { name: 'Clear selection' }).click();
  await expect(popup.locator('.bulk-count')).toHaveText('None selected');
  await popup.locator('#chat-search').fill('notes');
  await popup.getByRole('button', { name: 'Select all visible' }).click();
  await expect(popup.locator('.bulk-count')).toHaveText('1 selected');
  await expect(sel(popup, 'Client meeting notes')).toBeChecked();
  await popup.locator('#chat-search').fill('');
  await expect(sel(popup, 'Hello there')).not.toBeChecked();
  await popup.setViewportSize({ width: 380, height: 580 });
  await popup.screenshot({ path: `${SHOTS}/popup-chats-bulk-light.png` });
});

test('Working Set: bulk status, per-chat status, status views, sidebar status filter', async ({ context, extId }) => {
  const p = await openChat(context);
  const popup = await openPopupForChat(context, extId);
  await chatsTab(popup);

  await sel(popup, 'Fix TypeScript bug in parser').check();
  await sel(popup, 'Hello there').check();
  await popup.getByRole('button', { name: 'Mark selected as Active' }).click();
  const chats = (await settings(popup)).chats;
  expect(chats[`chatgpt:${ID.ts}`]).toMatchObject({ status: 'active' });
  expect(typeof chats[`chatgpt:${ID.ts}`]!.updatedAt).toBe('number'); // sync-ready
  expect(chats[`chatgpt:${ID.plain}`]!.updatedAt).toBe(chats[`chatgpt:${ID.ts}`]!.updatedAt); // one bulk timestamp

  // Per-chat status from the inline editor.
  await popup.locator('#chat-list .chat-row', { hasText: 'Weeknight recipe ideas' }).click();
  await popup.locator('.chat.open').getByRole('radio', { name: 'On hold' }).check();
  await expect(popup.locator('#chat-list .chat-row', { hasText: 'Weeknight recipe ideas' }).locator('.wstatus')).toHaveText('On hold');

  // Views.
  await popup.getByRole('button', { name: 'Active', exact: true }).click();
  await expect(popup.locator('#chat-list .chat-row')).toHaveCount(2);
  await popup.getByRole('button', { name: 'Unassigned', exact: true }).click();
  await expect(popup.locator('#chat-list .chat-title')).toHaveText(['Client meeting notes', 'Urgent launch checklist']);
  await popup.getByRole('button', { name: 'All', exact: true }).click();

  // Bulk "Unassigned" clears (kept as a timestamped null).
  await popup.getByRole('button', { name: 'Clear selection' }).click();
  await sel(popup, 'Hello there').check();
  await popup.getByRole('button', { name: 'Mark selected as Unassigned' }).click();
  expect((await settings(popup)).chats[`chatgpt:${ID.plain}`]).toMatchObject({ status: null });

  // Sidebar filter by status (Conversation tab -> Show in sidebar -> By working set).
  await popup.getByRole('tab', { name: 'Conversation' }).click();
  await popup.locator('.card', { hasText: 'By working set' }).getByRole('button', { name: /Active/ }).click();
  await p.bringToFront();
  const visible = () => p.locator(`${ROOT} [role="listitem"][data-crc]:visible`).evaluateAll((els) => els.map((e) => e.getAttribute('data-crc')));
  await expect.poll(visible).toEqual([ID.ts]);
  await expect(p.locator('.crc-filterbar')).toContainText('Showing Active · 1 chat');
  await p.locator('.crc-filterbar').getByRole('button', { name: 'Clear color filter' }).click();
  await expect.poll(async () => (await visible()).length).toBe(5);
});

test('Recently Revisited: records ids + times on navigation; lists chats opened twice; history switch and clear', async ({ context, extId }) => {
  const p = await openChat(context, ID.meeting); // visit 1: meeting
  const nav = (id: string) => item(p, id).locator('a').click();
  await nav(ID.ts); // ts 1
  await nav(ID.meeting); // meeting 2
  await nav(ID.recipe); // recipe 1
  await nav(ID.ts); // ts 2
  const popup = await openPopupForChat(context, extId);
  const readVisits = () => popup.evaluate(async () => (await chrome.storage.local.get('crc:visits'))['crc:visits'] as Record<string, { count: number }>);
  await expect.poll(async () => Object.keys(await readVisits()).length).toBe(3);
  const stored = await readVisits();
  expect(Object.keys(stored).sort()).toEqual([`chatgpt:${ID.meeting}`, `chatgpt:${ID.recipe}`, `chatgpt:${ID.ts}`].sort());
  expect(stored[`chatgpt:${ID.meeting}`]!.count).toBe(2);
  expect(JSON.stringify(stored)).not.toMatch(/Client|TypeScript|recipe ideas/); // ids + numbers only
  expect(Object.keys(await settings(popup))).not.toContain('visits'); // not in exported settings

  await chatsTab(popup);
  await popup.getByRole('button', { name: 'Recently revisited' }).click();
  await expect(popup.locator('#chat-list .chat-title')).toHaveText(['Fix TypeScript bug in parser', 'Client meeting notes']);
  await expect(popup.locator('#chat-list .chat-meta').first()).toContainText('2×');

  // History off: no further recording.
  await popup.getByRole('tab', { name: 'Data' }).click();
  await popup.getByRole('switch', { name: /Remember chats I revisit/ }).uncheck();
  await p.bringToFront();
  await nav(ID.recipe);
  await popup.bringToFront();
  expect((await readVisits())[`chatgpt:${ID.recipe}`]!.count).toBe(1);

  popup.on('dialog', (d) => d.accept());
  await popup.getByRole('button', { name: 'Clear history' }).click();
  await expect(popup.locator('#history-count')).toHaveText('No history yet.');
});

test('Presenter Mode: shortcut toggles, blur/dots, reveal on hover, colors kept, shortcut configurable, keys pass through', async ({ context, extId }) => {
  const p = await openChat(context);
  const conceal = () =>
    item(p, ID.ts).locator('a').evaluate((a) => {
      const cs = getComputedStyle(a);
      return { filter: cs.filter, dots: cs.getPropertyValue('-webkit-text-security') };
    });
  expect((await conceal()).filter).toBe('none');
  await p.evaluate(() => {
    (window as unknown as { __keys: string[] }).__keys = [];
    document.addEventListener('keydown', (e) => (window as unknown as { __keys: string[] }).__keys.push(e.code));
  });

  await p.keyboard.press('Alt+Shift+KeyP');
  await expect.poll(async () => (await conceal()).filter).toBe('blur(6px)');
  expect(await barColor(p, ID.ts)).toBe('#2f7de1'); // colors stay visible
  await expect(item(p, ID.meeting)).toHaveAttribute('data-crc-active', ''); // outline stays
  await p.locator(ROOT).screenshot({ path: `${SHOTS}/presenter-blur.png` });

  await item(p, ID.ts).hover(); // temporary reveal
  await expect.poll(async () => (await conceal()).filter).toBe('none');
  await p.mouse.move(800, 300);
  await expect.poll(async () => (await conceal()).filter).toBe('blur(6px)');

  await p.keyboard.press('KeyA');
  // Our combination's key never reaches the page; modifiers alone and ordinary keys do.
  const keys = await p.evaluate(() => (window as unknown as { __keys: string[] }).__keys);
  expect(keys).not.toContain('KeyP');
  expect(keys).toContain('KeyA');

  // Popup: obvious toggle state, dots style, no reveal, other shortcut.
  const popup = await openPopupForChat(context, extId);
  await expect(popup.locator('#presenter-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('.convo-title')).toHaveCSS('filter', 'blur(5px)'); // popup titles concealed too
  await popup.getByRole('tab', { name: 'Style' }).click();
  await popup.getByRole('radio', { name: 'Dots' }).check();
  await popup.getByRole('switch', { name: 'Reveal on hover or keyboard focus' }).uncheck();
  await popup.locator('#shortcut').selectOption('Ctrl+Alt+P');
  await p.bringToFront();
  await expect.poll(async () => (await conceal()).dots).toBe('disc');
  await item(p, ID.ts).hover();
  expect((await conceal()).dots).toBe('disc'); // reveal off
  await p.keyboard.press('Alt+Shift+KeyP'); // old shortcut no longer acts
  expect((await conceal()).dots).toBe('disc');
  await p.keyboard.press('Control+Alt+KeyP');
  await expect.poll(async () => (await conceal()).dots).toBe('none');

  // Header toggle in the popup turns it back on.
  await popup.bringToFront();
  await popup.locator('#presenter-toggle').click();
  await p.bringToFront();
  await expect.poll(async () => (await conceal()).dots).toBe('disc');
});

test('sidebar stays minimal in every new state: no dots, badges or extra controls in rows', async ({ context, extId }) => {
  const p = await openChat(context);
  const popup = await openPopupForChat(context, extId);
  await chatsTab(popup);
  await popup.getByRole('button', { name: 'Select all visible' }).click();
  await popup.getByRole('button', { name: 'Mark selected as Active' }).click();
  await popup.locator('#presenter-toggle').click();
  await p.bringToFront();
  for (const id of Object.values(ID)) {
    const r = item(p, id);
    await expect(r.locator('button, [role="button"], [tabindex], input')).toHaveCount(1); // only ChatGPT's own menu
    await expect(r.locator(':scope > :not(a):not(button):not(.crc-bar):not(.crc-fill)')).toHaveCount(0);
    const topAtMenu = await r.locator('button.menu').evaluate((m) => {
      const b = m.getBoundingClientRect();
      return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === m;
    });
    expect(topAtMenu).toBe(true);
  }
});
