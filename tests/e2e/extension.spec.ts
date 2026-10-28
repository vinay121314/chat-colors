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
const rowLoc = (p: Page, id: string) => p.locator(`#ds-sidebar [data-crc="${id}"]`);
/**
 * What the user actually sees: the rendered bar's color as #rrggbb plus its size ("#2f7de1 4px"),
 * or "none" when the row has no bar or it isn't painted.
 */
const shadowOf = (p: Page, id: string) =>
  rowLoc(p, id).evaluate((a) => {
    const bar = a.querySelector(':scope > .crc-bar');
    if (!bar) return 'none';
    const cs = getComputedStyle(bar);
    const r = bar.getBoundingClientRect();
    if (cs.display === 'none' || r.width === 0 || r.height === 0) return 'none';
    const m = cs.backgroundColor.match(/[\d.]+/g)!.map(Number);
    const hex = '#' + m.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return `${hex} ${Math.round(r.width)}px`;
  });
const tab = async (popup: Page, name: string) => popup.getByRole('tab', { name }).click();
const expand = async (popup: Page, name: string) => {
  const t = popup.locator('#categories .cat-toggle', { hasText: name });
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
};
const openPopup = async (context: BrowserContext, extId: string) => {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extId}/popup.html`);
  await p.locator('#categories li').first().waitFor({ state: 'attached' });
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

  await p.bringToFront(); // background tabs get no animation frames; a user would be looking at this tab
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

test('bar stays visible above opaque row content (hover/selected backgrounds on children)', async ({ context }) => {
  const p = await openChat(context);
  // Simulate a row whose inner content paints an opaque background over the whole row.
  await p.addStyleTag({ content: '#list .row .truncate { position: absolute; inset: 0; background: #ff00ff; }' });
  const hit = await rowLoc(p, ID.ts).evaluate((a) => {
    const bar = a.querySelector<HTMLElement>(':scope > .crc-bar')!;
    // The bar is pointer-events:none (never steals clicks); enable hit-testing only to probe paint order.
    bar.style.setProperty('pointer-events', 'auto', 'important');
    const r = bar.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.className;
    bar.style.removeProperty('pointer-events');
    return top;
  });
  expect(hit).toBe('crc-bar');
});

test('title-only link layout: decorates the row, nothing overlaps the title text', async ({ context }) => {
  const p = await openChat(context);
  const INLINE = '88888888-8888-4888-8888-888888888888';
  const row = p.locator('#inline-row');
  await expect(row).toHaveAttribute('data-crc', INLINE); // the row, not the <a>
  await row.hover();
  const g = await row.evaluate((r) => {
    const rect = (e: Element) => e.getBoundingClientRect();
    const text = rect(r.querySelector('a')!);
    const bar = rect(r.querySelector(':scope > .crc-bar')!);
    const fill = rect(r.querySelector(':scope > .crc-fill')!);
    const btn = rect(r.querySelector(':scope > .crc-btn')!);
    return { textL: text.left, textR: text.right, barR: bar.right, fillW: fill.width, rowW: rect(r).width, btnL: btn.left };
  });
  expect(g.barR).toBeLessThanOrEqual(g.textL); // bar sits before the title, not on it
  expect(g.btnL).toBeGreaterThanOrEqual(g.textR); // dot sits after the title, not on it
  expect(g.fillW).toBe(g.rowW); // fill spans the whole row
  expect(await shadowOf(p, INLINE)).toContain('#16a34a'); // "client" + "report" -> Work
});

test('fill mode tints the whole row; bar mode hides the fill', async ({ context, extId }) => {
  const p = await openChat(context);
  const fillOf = () =>
    rowLoc(p, ID.meeting).evaluate((a) => {
      const f = a.querySelector(':scope > .crc-fill');
      return f ? getComputedStyle(f).display + ' ' + Math.round(f.getBoundingClientRect().width) : 'none';
    });
  expect(await fillOf()).toMatch(/^block \d+/); // default: bar + fill
  const popup = await openPopup(context, extId);
  await tab(popup, 'Style');
  await popup.getByRole('radio', { name: 'Fill', exact: true }).check();
  await expect.poll(() => shadowOf(p, ID.meeting)).toBe('none'); // bar hidden
  await expect.poll(fillOf).toMatch(/^block/);
  await popup.locator('#fill').fill('30');
  await expect.poll(() => p.evaluate(() => document.getElementById('crc-vars')?.textContent ?? '')).toContain('--crc-f:30%');
  await popup.getByRole('radio', { name: 'Bar', exact: true }).check();
  await expect.poll(fillOf).toMatch(/^none/);
  await expect.poll(() => shadowOf(p, ID.meeting)).toContain('#16a34a');
});

test('diagnostics report is structural only', async ({ context, extId }) => {
  await openChat(context);
  const popup = await openPopup(context, extId);
  const d = await popup.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    for (const t of tabs) {
      const r = await chrome.tabs.sendMessage(t.id!, { type: 'crc:diag' }).catch(() => null);
      if (r) return r;
    }
    return null;
  });
  expect(d.rows).toBe(8);
  expect(d.colored).toBe(8);
  const text = JSON.stringify(d);
  expect(text).not.toMatch(/TypeScript|meeting|recipe|checklist|summary/i);
  expect(text).not.toContain(ID.ts);
});

test('popup: categories, rules, preview, priority, appearance, import/export', async ({ context, extId }) => {
  const p = await openChat(context);
  const popup = await openPopup(context, extId);
  popup.on('dialog', (d) => d.accept());
  await tab(popup, 'Rules');

  await popup.locator('#test-title').fill('Weekly CLIENT sync');
  await expect(popup.locator('#test-result')).toHaveText('Work');

  await expand(popup, 'Personal');
  const addPersonal = popup.getByRole('textbox', { name: 'Add keyword to Personal' });
  await addPersonal.fill('hello, greetings');
  await addPersonal.press('Enter');
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#e8590c'));
  const hello = popup.locator('#categories > li', { hasText: 'greetings' }).getByRole('checkbox', { name: 'hello' });
  await popup.locator('.kw label', { hasText: 'hello' }).click(); // users click the chip, the checkbox is visually hidden
  await expect(hello).not.toBeChecked();
  await expect.poll(() => shadowOf(p, ID.plain)).toContain(rgb('#8a8a8a'));

  // Priority: "Urgent launch checklist" matches Work (above Urgent) once 'launch' is added; then move Urgent up.
  await expand(popup, 'Work');
  const addWork = popup.getByRole('textbox', { name: 'Add keyword to Work' });
  await addWork.fill('launch');
  await addWork.press('Enter');
  await expect.poll(() => shadowOf(p, ID.project)).toContain(rgb('#16a34a'));
  await expand(popup, 'Urgent');
  const up = popup.getByRole('button', { name: 'Move Urgent up' });
  while (!(await up.isDisabled())) await up.click();
  await expect.poll(() => shadowOf(p, ID.project)).toContain(rgb('#e03131'));

  // Uncategorized border off
  await popup.getByRole('switch', { name: 'Show border for uncategorized chats' }).uncheck();
  await expect.poll(() => shadowOf(p, ID.plain)).toBe('none');

  await tab(popup, 'Style');
  await popup.locator('#thickness').fill('2');
  await expect.poll(() => shadowOf(p, ID.ts)).toBe('#2f7de1 2px');
  await expect(popup.locator('#preview b').first()).toHaveCSS('width', '2px');

  await tab(popup, 'Data');
  const [download] = await Promise.all([popup.waitForEvent('download'), popup.locator('#export').click()]);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  expect(exported.version).toBe(1);
  expect(exported.appearance.thickness).toBe(2);

  await popup.locator('#import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(popup.locator('#io-status')).toContainText('Import failed');
  exported.appearance.thickness = 6;
  await popup.locator('#import').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(popup.locator('#io-status')).toHaveText('Imported.');
  await expect.poll(() => shadowOf(p, ID.ts)).toBe('#2f7de1 6px');
});

test('popup tabs are keyboard navigable', async ({ context, extId }) => {
  const popup = await openPopup(context, extId);
  await popup.getByRole('tab', { name: 'Conversation' }).focus();
  await popup.keyboard.press('ArrowRight');
  await expect(popup.getByRole('tab', { name: 'Rules' })).toHaveAttribute('aria-selected', 'true');
  await expect(popup.locator('#panel-rules')).toBeVisible();
  for (const other of ['#panel-chat', '#panel-style', '#panel-data']) await expect(popup.locator(other)).toBeHidden();
  await popup.keyboard.press('ArrowLeft');
  await popup.keyboard.press('ArrowLeft');
  await expect(popup.getByRole('tab', { name: 'Data' })).toBeFocused();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} theme: popup + picker themed, bars visible (screenshots)`, async ({ context, extId }) => {
    const p = await openChat(context);
    await p.emulateMedia({ colorScheme: scheme });
    await p.setViewportSize({ width: 640, height: 460 });
    expect(await shadowOf(p, ID.ts)).toContain(rgb('#2f7de1'));
    await rowLoc(p, ID.meeting).hover();
    await p.locator('#ds-sidebar').screenshot({ path: `${SHOTS}/fixture-sidebar-${scheme}.png` });

    // In-page picker follows the page's actual background.
    await rowLoc(p, ID.meeting).locator('.crc-btn').click();
    const picker = p.locator('#crc-picker-host [popover]');
    await expect(picker).toHaveAttribute('data-theme', scheme);
    await p.screenshot({ path: `${SHOTS}/picker-${scheme}.png` });
    await p.keyboard.press('Escape');

    const popup = await openPopup(context, extId);
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 380, height: 580 });
    const bg = await popup.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === 'dark' ? 'rgb(17, 17, 19)' : 'rgb(255, 255, 255)');
    for (const name of ['Rules', 'Style', 'Data'] as const) {
      await tab(popup, name);
      if (name === 'Rules') await expand(popup, 'Development');
      await popup.screenshot({ path: `${SHOTS}/popup-${name.toLowerCase()}-${scheme}.png` });
    }
  });
}

for (const scheme of ['light', 'dark'] as const) {
  test(`popup conversation tab with a ChatGPT tab active (${scheme})`, async ({ context, extId }) => {
    const p = await openChat(context, `/c/${ID.meeting}`);
    const popup = await context.newPage();
    // Test-only: a real action popup's "active tab" is the ChatGPT tab. A popup opened as a tab can't
    // reproduce that, so make the active-tab query resolve to whichever tab runs our content script.
    await popup.addInitScript(() => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) => {
        const all = await query({});
        if (!info.active) return all;
        for (const t of all) if (await chrome.tabs.sendMessage(t.id!, { type: 'crc:current' }).catch(() => null)) return [t];
        return [];
      }) as typeof chrome.tabs.query;
    });
    await popup.emulateMedia({ colorScheme: scheme });
    await popup.setViewportSize({ width: 380, height: 580 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await expect(popup.locator('.convo-title')).toHaveText('Client meeting notes');
    await expect(popup.locator('#status')).toHaveAttribute('data-tone', 'ok');
    await expect(popup.locator('#status')).toContainText('8 chats detected');
    await expect(popup.locator('.badge')).toContainText('Automatic · Work');
    await popup.screenshot({ path: `${SHOTS}/popup-conversation-${scheme}.png` });

    await popup.getByRole('button', { name: 'Color #9b5de5' }).click();
    await expect.poll(() => shadowOf(p, ID.meeting)).toContain('#9b5de5');
    await expect(popup.locator('.badge')).toContainText('Manual color');
  });
}

