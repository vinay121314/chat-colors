import { describe, expect, it, vi } from 'vitest';
import {
  COLOR_ATTR,
  ID_ATTR,
  decorate,
  diagnose,
  findRoot,
  findRows,
  getTitle,
  maskPath,
  parseConversationId,
  rowBox,
  undecorate,
} from '../../src/content/adapter';
import { ID, mountPage, row } from '../fixtures/sidebar';

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
