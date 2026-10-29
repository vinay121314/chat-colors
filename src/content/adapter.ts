// The ONLY module that knows ChatGPT's DOM. Keep selectors here.
//
// Verified live (2026-10-28, logged-out page): the sidebar is `aside#ds-sidebar` containing
// `nav[data-slot="sidebar-history"][aria-label="Chat history"]`; class names are atomic/generated (unusable).
// UNVERIFIED (logged-in): conversation rows are `<a href="/c/<id>">` / `<a href="/g/<gizmo>/c/<id>">`.
// Because the logged-in markup is unverified, the root is derived from the conversation links themselves
// when the known containers don't hold any (see findRoot).
// UNVERIFIED (logged-in): Project / custom GPT entries are `<a href="/g/<gizmo>/project">` / `<a href="/g/<gizmo>">`.
import { GROUP_PATTERN, ID_PATTERN, normalizeId } from '../core/schema';

// Verified live (logged-in diagnostics, 2026-10-29): the sidebar root is
// `aside[data-app-shell-left-panel-appearance]`; each conversation row is a non-link wrapper with
// `role="listitem"`, `data-sidebar-cycle-item`, `data-thread-title-trigger` (~266x37) around the <a>
// (~247px wide); the open chat's link has `aria-current="page"`. The other selectors are fallbacks.
const ROOT_SELECTORS = [
  'aside[data-app-shell-left-panel-appearance]',
  '#ds-sidebar',
  'nav[data-slot="sidebar-history"]',
  'nav[aria-label="Chat history"]',
  '#history',
];
/** Verified live row wrappers, preferred over the structural heuristic in rowBox(). */
const ROW_SELECTOR = '[data-sidebar-cycle-item], [role="listitem"]';
const CONV_PATH = new RegExp(`^/(?:g/([^/]+)/)?c/(${ID_PATTERN})/?$`);
const GROUP_PATH = /^\/g\/([^/]+)(?:\/project)?\/?$/;
/** `g-p-<hex>-my-project` -> key `g-p-<hex>`, slug `my project`. */
const GROUP_SEGMENT = new RegExp(`^(${GROUP_PATTERN})(?:-(.+))?$`);
const CANDIDATES = 'a[href*="/c/"]';
const GROUP_CANDIDATES = 'a[href^="/g/"], a[href^="https://chatgpt.com/g/"]';
const NAV = 'nav, [role="navigation"]';

/** A Project or custom GPT: stable key from the URL, plus a readable slug as a name fallback. */
export interface Group {
  key: string;
  slug: string;
}

function pathOf(href: string | null): string | null {
  return (href && /^(?:https:\/\/chatgpt\.com)?(\/[^?#]*)/.exec(href)?.[1]) || null;
}

function groupOf(segment: string | undefined): Group | null {
  const m = segment ? GROUP_SEGMENT.exec(segment) : null;
  return m ? { key: m[1]!, slug: (m[2] ?? '').replace(/-/g, ' ').trim() } : null;
}

/** The Project/GPT a conversation link belongs to, from its URL. */
export function parseChatGroup(href: string | null): Group | null {
  const p = pathOf(href);
  return p ? groupOf(CONV_PATH.exec(p)?.[1]) : null;
}

/** A sidebar link to a Project or custom GPT itself (not one of its chats). */
export function parseGroupLink(href: string | null): Group | null {
  const p = pathOf(href);
  return p ? groupOf(GROUP_PATH.exec(p)?.[1]) : null;
}

export const kindOf = (key: string) => (key.startsWith('g-p-') ? 'Project' : 'GPT');

export const ID_ATTR = 'data-crc';
export const COLOR_ATTR = 'data-crc-color';
const BTN_CLASS = 'crc-btn';
const BAR_CLASS = 'crc-bar';
const FILL_CLASS = 'crc-fill';
const POS_CLASS = 'crc-pos';
/** Never climb into these when looking for a row container. */
const ROW_STOP = 'nav, aside, section, ul, ol, main, body, [role="navigation"], [role="list"]';

export interface Row {
  el: HTMLAnchorElement;
  id: string;
}

export interface GroupRow {
  el: HTMLAnchorElement;
  group: Group;
}

/** Conversation id from a relative or chatgpt.com href; null for anything else. */
export function parseConversationId(href: string | null): string | null {
  const p = pathOf(href);
  return normalizeId(p ? CONV_PATH.exec(p)?.[2] : undefined);
}

function hasRows(root: ParentNode): boolean {
  for (const a of root.querySelectorAll(CANDIDATES)) if (parseConversationId(a.getAttribute('href'))) return true;
  return false;
}

function outermost(el: Element, sel: string): Element | null {
  let found: Element | null = null;
  for (let p = el.closest(sel); p; p = p.parentElement?.closest(sel) ?? null) found = p;
  return found;
}

/**
 * 1. A known sidebar container that holds conversation links.
 * 2. Otherwise the <aside>/outermost navigation landmark around the first conversation link
 *    (links in message bodies are never inside navigation, so they are not picked up).
 * 3. Otherwise a known container (rows may not have rendered yet), else null.
 */
export function findRoot(doc: Document = document): Element | null {
  let known: Element | null = null;
  for (const s of ROOT_SELECTORS) if ((known = doc.querySelector(s))) break;
  if (known && hasRows(known)) return known;
  for (const a of doc.querySelectorAll(CANDIDATES)) {
    if (!parseConversationId(a.getAttribute('href'))) continue;
    const nav = a.closest('aside') ?? outermost(a, NAV);
    if (nav) return nav;
  }
  return known;
}

export function findRows(root: ParentNode): Row[] {
  const rows: Row[] = [];
  for (const el of root.querySelectorAll<HTMLAnchorElement>(CANDIDATES)) {
    const id = parseConversationId(el.getAttribute('href'));
    if (id) rows.push({ el, id });
  }
  return rows;
}

/** Sidebar entries for Projects / custom GPTs themselves. */
export function findGroupRows(root: ParentNode): GroupRow[] {
  const rows: GroupRow[] = [];
  for (const el of root.querySelectorAll<HTMLAnchorElement>(GROUP_CANDIDATES)) {
    const group = parseGroupLink(el.getAttribute('href'));
    if (group) rows.push({ el, group });
  }
  return rows;
}

/** Visible title only: text inside the row, skipping buttons (ChatGPT's row menu, our control). */
export function getTitle(a: Element): string {
  let s = '';
  const w = a.ownerDocument.createTreeWalker(a, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const b = n.parentElement?.closest('button, [role="button"]');
    if (!b || !a.contains(b)) s += n.nodeValue;
  }
  return s.replace(/\s+/g, ' ').trim();
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

const positioned = new WeakSet<Element>();
const boxes = new WeakMap<Element, Element>();

const isTarget = (a: Element) => {
  const h = a.getAttribute('href');
  return !!(parseConversationId(h) || parseGroupLink(h));
};

/** Number of links we decorate (chats, Projects, GPTs) inside el, counting el itself. */
function convCount(el: Element): number {
  let n = el.matches('a[href]') && isTarget(el) ? 1 : 0;
  for (const a of el.querySelectorAll('a[href]')) if (isTarget(a)) n++;
  return n;
}

const marked = (a: Element) => {
  const v = a.getAttribute('aria-current');
  return v === 'page' || v === 'true';
};

/**
 * The row for the conversation open in this tab. If ChatGPT marks any row with
 * `aria-current="page"` (verified live), only that marker is trusted; otherwise fall back to the URL.
 * Decided across the whole list so a stale URL can never produce a second "active" row.
 */
export function activeRow<R extends { el: Element; id: string }>(rows: R[], path: string = location.pathname): R | undefined {
  const byMarker = rows.find((r) => marked(r.el));
  if (byMarker) return byMarker;
  const id = parseConversationId(path);
  return id ? rows.find((r) => r.id === id) : undefined;
}

/** The chat/Project/GPT link a decorated row container stands for. */
function primaryLink(box: Element): HTMLAnchorElement | null {
  if (box instanceof HTMLAnchorElement && isTarget(box)) return box;
  return [...box.querySelectorAll<HTMLAnchorElement>('a[href]')].find(isTarget) ?? null;
}

/**
 * The visual row for a conversation link. On some layouts the <a> wraps only the title and the
 * full-width row is an ancestor; decorating the <a> would then put the bar/dot on top of the text.
 * Climb while the parent still holds exactly this one conversation and is still one row tall.
 */
export function rowBox(a: Element): Element {
  const cached = boxes.get(a);
  if (cached?.isConnected && cached.contains(a)) return cached;
  // 1. Verified live wrapper, as long as it really is this one row (holds no other chat/Project link).
  const known = a.closest(ROW_SELECTOR);
  if (known && !known.matches(ROW_STOP) && convCount(known) === 1) {
    boxes.set(a, known);
    return known;
  }
  // 2. Structural heuristic for other layouts.
  const ah = a.getBoundingClientRect().height;
  let box = a;
  for (let p = a.parentElement; p && !p.matches(ROW_STOP); p = p.parentElement) {
    if (convCount(p) !== 1) break;
    if (p.getBoundingClientRect().height > Math.max(ah * 1.9, 52)) break; // grew past one row (e.g. a group header)
    box = p;
  }
  boxes.set(a, box);
  return box;
}

function child(el: Element, cls: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`:scope > .${cls}`);
}

function ensureChild(el: Element, cls: string, want: boolean): void {
  const c = child(el, cls);
  if (want && !c) {
    const s = document.createElement('span');
    s.className = cls;
    s.setAttribute('aria-hidden', 'true');
    el.append(s);
  } else if (!want && c) {
    c.remove();
  }
}

/**
 * Idempotent: writes only what changed; at most one bar, fill and control per row.
 * Decorates the row container (see rowBox), not necessarily the <a>. Color is drawn by our own
 * absolutely positioned elements (above the row's own backgrounds, pointer-events:none), so ChatGPT's
 * row styles are never modified, apart from position:relative on a static row.
 * Returns the decorated element.
 */
export function decorate(
  row: Row,
  color: string | null,
  title: string,
  onOpen: ((btn: HTMLButtonElement, row: Row) => void) | null,
): HTMLElement {
  const el = rowBox(row.el) as HTMLElement;
  const { id } = row;
  setAttr(el, ID_ATTR, id);
  setAttr(el, COLOR_ATTR, color ? '' : null);
  if (el.style.getPropertyValue('--crc-c') !== (color ?? '')) {
    if (color) el.style.setProperty('--crc-c', color);
    else el.style.removeProperty('--crc-c');
  }
  // One computed-style read per row lifetime (WeakSet), not per scan.
  if (!positioned.has(el)) {
    positioned.add(el);
    if (getComputedStyle(el).position === 'static') el.classList.add(POS_CLASS);
  }

  ensureChild(el, FILL_CLASS, !!color);
  ensureChild(el, BAR_CLASS, !!color);

  if (!onOpen) return el;
  let btn = child(el, BTN_CLASS) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    const dot = document.createElement('span');
    dot.className = 'crc-dot';
    btn.append(dot);
    const b = btn;
    // Stop at the button so the anchor never navigates and ChatGPT's root-delegated handlers never see it.
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const box = b.parentElement;
      const rid = box?.getAttribute(ID_ATTR);
      const a = box ? primaryLink(box) : null;
      if (a && rid) onOpen(b, { el: a, id: rid });
    });
    // Native <button> turns Enter/Space into click; just keep the keys away from ChatGPT's shortcuts.
    b.addEventListener('keydown', (e) => e.stopPropagation());
    el.append(btn);
  }
  setAttr(btn, 'aria-label', `Set color for ${title || 'conversation'}`);
  setAttr(btn, 'title', 'Set color');
  return el;
}

/** Remove everything we added to this row. */
export function undecorate(el: Element): void {
  el.removeAttribute(ID_ATTR);
  el.removeAttribute(COLOR_ATTR);
  el.classList.remove(POS_CLASS);
  positioned.delete(el);
  (el as HTMLElement).style?.removeProperty('--crc-c');
  el.removeAttribute(HIDDEN_ATTR);
  el.removeAttribute(ACTIVE_ATTR);
  child(el, BTN_CLASS)?.remove();
  child(el, BAR_CLASS)?.remove();
  child(el, FILL_CLASS)?.remove();
}

// ---------------------------------------------------------------------------------------------
// Filter: hide non-matching rows (CSS on our own attribute) and show a sticky "Showing …" pill.

const HIDDEN_ATTR = 'data-crc-hidden';
const ACTIVE_ATTR = 'data-crc-active';

/** Marks the row of the conversation open in this tab (outlined by content.css). */
export function setActive(el: Element, on: boolean): void {
  if (el.hasAttribute(ACTIVE_ATTR) !== on) el.toggleAttribute(ACTIVE_ATTR, on);
}

export function setHidden(el: Element, hidden: boolean): void {
  if (el.hasAttribute(HIDDEN_ATTR) !== hidden) el.toggleAttribute(HIDDEN_ATTR, hidden);
}

let filterBar: HTMLElement | null = null;

export interface FilterInfo {
  color: string;
  label: string;
  count: number;
}

/** Shows (or removes, when info is null) the filter pill just above the first chat row. */
export function renderFilterBar(firstRow: Element | null, info: FilterInfo | null, onClear: () => void): void {
  if (!info || !firstRow?.parentElement) {
    filterBar?.remove();
    filterBar = null;
    return;
  }
  if (!filterBar) {
    filterBar = document.createElement('div');
    filterBar.className = 'crc-filterbar';
    filterBar.setAttribute('role', 'status');
    const dot = document.createElement('i');
    const text = document.createElement('span');
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.textContent = 'Clear';
    clear.setAttribute('aria-label', 'Clear color filter');
    clear.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClear();
    });
    filterBar.append(dot, text, clear);
  }
  // Opaque background sampled from the sidebar itself, so the sticky pill matches ChatGPT's theme.
  for (let n: Element | null = firstRow.parentElement; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
      filterBar.style.setProperty('--crc-bg', bg);
      break;
    }
  }
  const [dot, text] = filterBar.children as unknown as [HTMLElement, HTMLElement];
  dot.style.setProperty('--crc-c', info.color);
  const label = `Showing ${info.label} · ${info.count} chat${info.count === 1 ? '' : 's'}`;
  if (text.textContent !== label) text.textContent = label;
  if (filterBar.nextElementSibling !== firstRow) firstRow.parentElement.insertBefore(filterBar, firstRow);
}

export function decorated(root: ParentNode): Element[] {
  return [...root.querySelectorAll(`[${ID_ATTR}]`)];
}

// ---------------------------------------------------------------------------------------------
// Diagnostics: page STRUCTURE only. No titles or text (only lengths), ids and slugs masked.

const SAFE_ATTRS = new Set(['role', 'type', 'data-slot', 'data-testid', 'data-state', 'draggable', 'tabindex', 'aria-current']);
const LANDMARK = /^(nav|aside|section|header|ul|ol)$/;

export function maskPath(h: string): string {
  return h
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\/(c|g|project|share|gpts)\/(?!<uuid>)[^/?#]+/g, '/$1/<id>')
    .replace(/[?#].*$/, '');
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const attrs = [...el.attributes]
    .filter((a) => a.name !== 'class' && a.name !== 'style' && !a.name.startsWith('data-crc'))
    .map((a) => {
      if (a.name === 'id') return `#${a.value}`;
      if (a.name === 'href') return `href=${maskPath(a.value)}`;
      if (a.name === 'aria-label' && LANDMARK.test(tag)) return `aria-label="${a.value.slice(0, 40)}"`;
      return SAFE_ATTRS.has(a.name) ? `${a.name}="${a.value.slice(0, 40)}"` : a.name;
    });
  const classes = el.classList.length ? ` .${el.classList.length}cls` : '';
  return `${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}${classes}`;
}

function tree(el: Element, depth = 0): string[] {
  if (depth > 5) return [];
  const pad = '  '.repeat(depth);
  const out = [pad + describe(el)];
  for (const n of el.childNodes) {
    if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()) out.push(`${pad}  #text(${n.nodeValue.trim().length})`);
    else if (n instanceof Element && ![BTN_CLASS, BAR_CLASS, FILL_CLASS].some((c) => n.classList.contains(c))) out.push(...tree(n, depth + 1));
  }
  return out;
}

export function diagnose(doc: Document = document) {
  const root = findRoot(doc);
  const rows = root ? findRows(root) : [];
  const anchors = [...doc.querySelectorAll('a[href]')];
  const shapes = new Map<string, number>();
  for (const a of anchors) {
    const h = a.getAttribute('href') ?? '';
    if (!h.includes('/c/')) continue;
    const k = `${a.closest('nav, aside, [role="navigation"]') ? 'in-nav' : 'outside-nav'} ${maskPath(h)}`;
    shapes.set(k, (shapes.get(k) ?? 0) + 1);
  }
  const sample = rows[0]?.el ?? anchors.find((a) => a.getAttribute('href')?.includes('/c/'));
  const ancestry: string[] = [];
  for (let p = sample?.parentElement; p && p !== doc.body && ancestry.length < 12; p = p.parentElement) ancestry.push(describe(p));
  const box = sample ? rowBox(sample) : null;
  const cs = box ? getComputedStyle(box) : null;
  const bar = box?.querySelector(`:scope > .${BAR_CLASS}`);

  // Regular vs Project vs custom GPT handling (counts only; keys never reported).
  const kinds = { chats: 0, projectChats: 0, gptChats: 0, projectEntries: 0, gptEntries: 0 };
  for (const r of rows) {
    const g = parseChatGroup(r.el.getAttribute('href'));
    kinds[!g ? 'chats' : g.key.startsWith('g-p-') ? 'projectChats' : 'gptChats']++;
  }
  for (const r of root ? findGroupRows(root) : []) kinds[r.group.key.startsWith('g-p-') ? 'projectEntries' : 'gptEntries']++;
  // /g/ links we did NOT recognise: masked shapes tell us if the Project/GPT URL format differs.
  const unrecognized = new Map<string, number>();
  for (const a of root?.querySelectorAll('a[href*="/g/"]') ?? []) {
    const h = a.getAttribute('href') ?? '';
    if (parseConversationId(h) || parseGroupLink(h)) continue;
    const k = maskPath(h);
    unrecognized.set(k, (unrecognized.get(k) ?? 0) + 1);
  }
  // How ChatGPT marks the open chat natively (attribute names/values like aria-current="page"; no text).
  const openId = parseConversationId(location.pathname);
  const openRow = openId ? rows.find((r) => r.id === openId) : undefined;
  const stateAttrs = (el: Element | null | undefined) =>
    el
      ? [...el.attributes]
          .filter((a) => /^(aria-current|aria-selected|aria-pressed)$|active|selected|current|state/i.test(a.name) && !a.name.startsWith('data-crc'))
          .map((a) => `${a.name}="${a.value.slice(0, 20)}"`)
      : [];
  const otherRow = rows.find((r) => r.id !== openId);
  const bgOf = (el: Element | undefined) => (el ? getComputedStyle(rowBox(el)).backgroundColor : null);

  return {
    navigationApi: 'navigation' in window,
    kinds,
    unrecognizedGroupLinks: Object.fromEntries([...unrecognized].slice(0, 12)),
    openChat: openId
      ? {
          inSidebar: !!openRow,
          linkStateAttrs: stateAttrs(openRow?.el),
          rowStateAttrs: openRow ? stateAttrs(rowBox(openRow.el)) : [],
          rowBackground: bgOf(openRow?.el),
          otherRowBackground: bgOf(otherRow?.el),
        }
      : null,
    path: maskPath(location.pathname),
    knownContainers: Object.fromEntries(ROOT_SELECTORS.map((s) => [s, !!doc.querySelector(s)])),
    root: root ? describe(root) : null,
    rows: rows.length,
    decorated: doc.querySelectorAll(`[${ID_ATTR}]`).length,
    colored: doc.querySelectorAll(`.${BAR_CLASS}`).length,
    conversationHrefShapes: Object.fromEntries([...shapes].slice(0, 12)),
    sampleRow: box ? tree(box) : null,
    sampleRowIsLink: box === sample,
    sampleAncestry: ancestry,
    sampleRowStyle: cs && {
      position: cs.position,
      display: cs.display,
      overflow: cs.overflow,
      zIndex: cs.zIndex,
      borderRadius: cs.borderRadius,
      paddingLeft: cs.paddingLeft,
      width: Math.round(box!.getBoundingClientRect().width),
      height: Math.round(box!.getBoundingClientRect().height),
      linkWidth: Math.round(sample!.getBoundingClientRect().width),
    },
    barStyle: bar && (() => {
      const b = getComputedStyle(bar);
      const r = bar.getBoundingClientRect();
      return { display: b.display, background: b.backgroundColor, width: Math.round(r.width), height: Math.round(r.height) };
    })(),
  };
}

export type Diagnostics = ReturnType<typeof diagnose>;
