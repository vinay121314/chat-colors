import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_ATTR,
  ID_ATTR,
  decorate,
  diagnose,
  findRoot,
  findRows,
  activeRow,
  getTitle,
  maskPath,
  parseChatGroup,
  parseConversationId,
  parseGroupLink,
  rowBox,
  undecorate,
} from '../../src/content/adapter';
import { ID, mountLivePage, mountPage, row } from '../fixtures/sidebar';

const U = '6735a0f2-1c3d-8007-9a6b-0123456789ab';

describe('parseConversationId', () => {
  it.each([
    [`/c/${U}`, U],
    [`/c/${U}/`, U],
    [`/c/${U.toUpperCase()}`, U],
    [`/c/${U}?model=x#y`, U],
    [`https://chatgpt.com/c/${U}`, U],
    [`/g/g-p-0123456789abcdef0123456789abcdef-my-project/c/${U}`, U], // Project chat
    [`/g/g-AbCdEf123-code-helper/c/${U}`, U], // custom GPT chat
    ['/c/WEB_abc-123XYZ', 'WEB_abc-123XYZ'], // non-UUID id format: accepted, case preserved
  ])('%s -> id', (href, id) => expect(parseConversationId(href)).toBe(id));

  it.each([
    null,
    '',
    '/',
    '/gpts',
    '/images',
    `/g/g-p-0123-my-project/project`,
    '/g/g-AbCdEf123-code-helper',
    `/c/short`,
    `/c/has space here`,
    `/share/${U}`,
    `/c/${U}/extra`,
    `https://evil.example/c/${U}`,
    `//evil.example/c/${U}`,
    `/x/g/abc/c/${U}`,
  ])('%p -> null', (href) => expect(parseConversationId(href)).toBeNull());
});

describe('Project / GPT parsing', () => {
  const P = 'g-p-0123456789abcdef0123456789abcdef';
  it.each([
    [`/g/${P}-my-side-project/c/${U}`, P, 'my side project'],
    [`https://chatgpt.com/g/${P}/c/${U}`, P, ''],
    [`/g/g-AbCdEf123-code-helper/c/${U}`, 'g-AbCdEf123', 'code helper'],
  ])('chat %s belongs to %s', (href, key, slug) => expect(parseChatGroup(href)).toEqual({ key, slug }));

  it('plain chats have no group', () => expect(parseChatGroup(`/c/${U}`)).toBeNull());

  it.each([
    [`/g/${P}-my-side-project/project`, P],
    [`/g/g-AbCdEf123-code-helper`, 'g-AbCdEf123'],
  ])('entry link %s -> %s', (href, key) => expect(parseGroupLink(href)?.key).toBe(key));

  it.each(['/gpts', '/g/', '/g/x', `/g/${P}/c/${U}`, '/g/g-ab/project'])('%s is not an entry link', (href) =>
    expect(parseGroupLink(href)).toBeNull(),
  );
});

describe('verified live structure (logged-in diagnostics)', () => {
  it('uses aside[data-app-shell-left-panel-appearance] as the root', () => {
    mountLivePage();
    expect(findRoot()?.matches('aside[data-app-shell-left-panel-appearance]')).toBe(true);
  });

  it('decorates the listitem wrapper (not the link), and never the message-body link', () => {
    const { main } = mountLivePage();
    const rows = findRows(findRoot()!);
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(rowBox(r.el).getAttribute('role')).toBe('listitem');
      expect(rowBox(r.el).hasAttribute('data-sidebar-cycle-item')).toBe(true);
    }
    const box = decorate(rows[0]!, '#ff0000', 'x', vi.fn());
    expect(box.getAttribute('role')).toBe('listitem');
    expect(rows[0]!.el.hasAttribute(ID_ATTR)).toBe(false);
    expect(main.querySelector('[data-crc]')).toBeNull();
  });

  it('keeps the native menu button and adds exactly one control next to it', () => {
    mountLivePage();
    const r = findRows(findRoot()!)[0]!;
    for (let i = 0; i < 3; i++) decorate(r, '#ff0000', 'x', vi.fn());
    const box = rowBox(r.el);
    expect(box.querySelectorAll('.crc-btn')).toHaveLength(1);
    expect(box.querySelector('button[aria-label="Open conversation options"]')).not.toBeNull();
  });

  it('activeRow prefers aria-current="page" over the URL, never yields two, falls back to the URL', () => {
    mountLivePage(ID.meeting);
    const rows = findRows(findRoot()!);
    expect(activeRow(rows, `/c/${ID.ts}`)?.id).toBe(ID.meeting); // marker wins over a stale URL
    for (const r of rows) r.el.removeAttribute('aria-current');
    expect(activeRow(rows, `/c/${ID.ts}`)?.id).toBe(ID.ts); // fallback when ChatGPT marks nothing
    expect(activeRow(rows, '/')).toBeUndefined();
  });

  it('does not take a listitem that wraps several chats as one row', () => {
    const list = document.createElement('div');
    list.setAttribute('role', 'listitem');
    const ul = document.createElement('ul');
    const li1 = document.createElement('li');
    const li2 = document.createElement('li');
    li1.append(row(`/c/${ID.ts}`, 'a'));
    li2.append(row(`/c/${ID.meeting}`, 'b'));
    ul.append(li1, li2);
    list.append(ul);
    document.body.append(list);
    expect(rowBox(li1.firstElementChild!)).toBe(li1);
  });
});

describe('discovery', () => {
  it('finds only conversation links inside the sidebar root', () => {
    mountPage();
    const root = findRoot()!;
    expect(root.id).toBe('ds-sidebar');
    const ids = findRows(root).map((r) => r.id);
    expect(ids).toEqual([ID.ts, ID.meeting, ID.recipe, ID.plain, ID.project, ID.gpt]);
    expect(ids).not.toContain(ID.main);
  });

  it('returns null root on an unsupported layout', () => {
    document.body.append(row(`/c/${ID.ts}`, 'orphan link'));
    expect(findRoot()).toBeNull();
  });

  it('derives the root from conversation links in a navigation landmark when known containers are absent', () => {
    const nav = document.createElement('nav');
    const inner = document.createElement('nav');
    inner.append(row(`/c/${ID.ts}`, 'python'));
    nav.append(inner);
    document.body.append(row(`/c/${ID.main}`, 'link in a message'), nav);
    expect(findRoot()).toBe(nav); // outermost nav, not the message link
  });

  it('prefers the <aside> holding the links when the known container is empty', () => {
    const empty = document.createElement('nav');
    empty.setAttribute('aria-label', 'Chat history');
    const aside = document.createElement('aside');
    const list = document.createElement('div');
    list.append(row(`/c/${ID.ts}`, 'python'));
    aside.append(list);
    document.body.append(empty, aside);
    expect(findRoot()).toBe(aside);
  });

  it('falls back to the history nav if #ds-sidebar is absent', () => {
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'Chat history');
    document.body.append(nav);
    expect(findRoot()).toBe(nav);
  });

  it('extracts the visible title, normalising whitespace', () => {
    const a = row(`/c/${ID.ts}`, '  Fix   TypeScript\n bug ');
    expect(getTitle(a)).toBe('Fix TypeScript bug');
  });

  it('ignores text inside buttons in the row (native row menu, sr-only labels)', () => {
    const a = row(`/c/${ID.ts}`, 'Client call');
    const menu = document.createElement('button');
    menu.textContent = '… Open conversation options';
    const fake = document.createElement('span');
    fake.setAttribute('role', 'button');
    fake.textContent = 'urgent';
    a.append(menu, fake);
    expect(getTitle(a)).toBe('Client call');
  });
});

describe('decorate', () => {
  it('is idempotent: one control, attributes set once', () => {
    const a = row(`/c/${ID.ts}`, 'Title');
    document.body.append(a);
    const open = vi.fn();
    for (let i = 0; i < 3; i++) decorate({ el: a, id: ID.ts }, '#ff0000', 'Title', open);
    expect(a.querySelectorAll('.crc-btn')).toHaveLength(1);
    expect(a.querySelectorAll('.crc-bar')).toHaveLength(1);
    expect(a.getAttribute(ID_ATTR)).toBe(ID.ts);
    expect(a.hasAttribute(COLOR_ATTR)).toBe(true);
    expect(a.style.getPropertyValue('--crc-c')).toBe('#ff0000');
    expect(getTitle(a)).toBe('Title'); // control adds no text
  });

  it('removes color when resolved to null', () => {
    const a = row(`/c/${ID.ts}`, 'Title');
    decorate({ el: a, id: ID.ts }, '#ff0000', 'Title', null);
    decorate({ el: a, id: ID.ts }, null, 'Title', null);
    expect(a.hasAttribute(COLOR_ATTR)).toBe(false);
    expect(a.style.getPropertyValue('--crc-c')).toBe('');
    expect(a.querySelector('.crc-bar')).toBeNull();
  });

  it('control is keyboard-focusable and labelled', () => {
    const a = row(`/c/${ID.ts}`, 'Client call');
    document.body.append(a);
    decorate({ el: a, id: ID.ts }, '#ff0000', 'Client call', vi.fn());
    const btn = a.querySelector<HTMLButtonElement>('.crc-btn')!;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.type).toBe('button');
    expect(btn.getAttribute('aria-label')).toBe('Set color for Client call');
    btn.focus();
    expect(document.activeElement).toBe(btn);
  });

  it('control click opens the picker without navigating or reaching page handlers', () => {
    const a = row(`/c/${ID.ts}`, 'Title');
    document.body.append(a);
    const pageHandler = vi.fn();
    document.addEventListener('click', pageHandler); // ChatGPT/React delegates at the root
    const open = vi.fn();
    decorate({ el: a, id: ID.ts }, '#ff0000', 'Title', open);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.querySelector('.crc-btn')!.dispatchEvent(ev);
    expect(open).toHaveBeenCalledOnce();
    expect(ev.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
    document.removeEventListener('click', pageHandler);
  });

  it('diagnostics expose structure but never titles or raw ids', () => {
    mountPage();
    decorate({ el: document.querySelector<HTMLAnchorElement>(`a[href="/c/${ID.ts}"]`)!, id: ID.ts }, '#ff0000', 'x', vi.fn());
    const d = diagnose();
    const text = JSON.stringify(d);
    expect(d.rows).toBe(6);
    expect(d.root).toContain('#ds-sidebar');
    expect(d.colored).toBe(1);
    expect(text).not.toMatch(/TypeScript|meeting|recipe|Hello|Research|urgent/i);
    for (const id of Object.values(ID)) expect(text).not.toContain(id);
    expect(text).not.toContain('side-project'); // project slug masked
    expect(d.sampleRow?.join('\n')).toMatch(/#text\(\d+\)/);
    // Regular / Project / GPT handling is reported as counts only.
    expect(d.kinds).toEqual({ chats: 4, projectChats: 1, gptChats: 1, projectEntries: 1, gptEntries: 0 });
    expect(d.unrecognizedGroupLinks).toEqual({});
    expect(text).not.toContain('0123456789abcdef'); // project key masked
  });

  it('maskPath hides ids and slugs', () => {
    expect(maskPath(`/g/g-p-abc-my-secret-project/c/${U}?x=1`)).toBe('/g/<id>/c/<uuid>');
    expect(maskPath('/c/WEB_abc-123XYZ')).toBe('/c/<id>');
  });

  it('decorates the row container when the <a> wraps only the title', () => {
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    const inner = document.createElement('div');
    const a = row(`/c/${ID.ts}`, 'Title only');
    inner.append(a);
    li.append(inner);
    ul.append(li, document.createElement('li'));
    document.body.append(ul);
    expect(rowBox(a)).toBe(li); // climbs to the single-conversation container, stops at the list
    const box = decorate({ el: a, id: ID.ts }, '#ff0000', 'Title only', vi.fn());
    expect(box).toBe(li);
    expect(li.getAttribute(ID_ATTR)).toBe(ID.ts);
    expect(li.querySelector(':scope > .crc-bar')).not.toBeNull();
    expect(li.querySelector(':scope > .crc-fill')).not.toBeNull();
    expect(a.hasAttribute(ID_ATTR)).toBe(false);
  });

  it('does not climb into a container that holds other conversations', () => {
    mountPage();
    const a = document.querySelector(`a[href="/c/${ID.ts}"]`)!;
    expect(rowBox(a)).toBe(a);
  });

  it('undecorate restores the row', () => {
    const a = row(`/c/${ID.ts}`, 'Title');
    document.body.append(a);
    const before = a.outerHTML;
    decorate({ el: a, id: ID.ts }, '#ff0000', 'Title', vi.fn());
    undecorate(a);
    expect(a.querySelector('.crc-btn')).toBeNull();
    expect(a.hasAttribute(ID_ATTR) || a.hasAttribute(COLOR_ATTR)).toBe(false);
    expect(a.outerHTML.replace(/ (style|class)="[^"]*"/g, '')).toBe(before.replace(/ (style|class)="[^"]*"/g, ''));
  });
});
