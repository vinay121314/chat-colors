// The ONLY module that knows ChatGPT's DOM. Keep selectors here.
//
// Verified live (2026-10-28, logged-out page): the sidebar is `aside#ds-sidebar` containing
// `nav[data-slot="sidebar-history"][aria-label="Chat history"]`; class names are atomic/generated (unusable).
// UNVERIFIED (logged-in): conversation rows are `<a href="/c/<id>">` / `<a href="/g/<gizmo>/c/<id>">`.
// Because the logged-in markup is unverified, the root is derived from the conversation links themselves
// when the known containers don't hold any (see findRoot).
import { ID_PATTERN, normalizeId } from '../core/schema';

const ROOT_SELECTORS = ['#ds-sidebar', 'nav[data-slot="sidebar-history"]', 'nav[aria-label="Chat history"]', '#history'];
const CONV_PATH = new RegExp(`^/(?:g/[^/]+/)?c/(${ID_PATTERN})/?$`);
const CANDIDATES = 'a[href*="/c/"]';
const NAV = 'nav, [role="navigation"]';

export const ID_ATTR = 'data-crc';
export const COLOR_ATTR = 'data-crc-color';
const BTN_CLASS = 'crc-btn';
const BAR_CLASS = 'crc-bar';
const POS_CLASS = 'crc-pos';

export interface Row {
  el: HTMLAnchorElement;
  id: string;
}

/** Conversation id from a relative or chatgpt.com href; null for anything else. */
export function parseConversationId(href: string | null): string | null {
  if (!href) return null;
  const m = /^(?:https:\/\/chatgpt\.com)?(\/[^?#]*)/.exec(href);
  const id = m?.[1] ? CONV_PATH.exec(m[1])?.[1] : undefined;
  return normalizeId(id);
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

function child(el: Element, cls: string): HTMLElement | null {
  return el.querySelector<HTMLElement>(`:scope > .${cls}`);
}

/**
 * Idempotent: writes only what changed; at most one bar and one control per row.
 * The color is drawn by our own absolutely positioned bar (above the row's own backgrounds),
 * so ChatGPT's row styles are never modified, apart from position:relative on a static row.
 */
export function decorate(
  row: Row,
  color: string | null,
  title: string,
  onOpen: ((btn: HTMLButtonElement, row: Row) => void) | null,
): void {
  const { el, id } = row;
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

  const bar = child(el, BAR_CLASS);
  if (color && !bar) {
    const b = document.createElement('span');
    b.className = BAR_CLASS;
    b.setAttribute('aria-hidden', 'true');
    el.append(b);
  } else if (!color && bar) {
    bar.remove();
  }

  if (!onOpen) return;
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
      const a = b.parentElement;
      const rid = a?.getAttribute(ID_ATTR);
      if (a instanceof HTMLAnchorElement && rid) onOpen(b, { el: a, id: rid });
    });
    // Native <button> turns Enter/Space into click; just keep the keys away from ChatGPT's shortcuts.
    b.addEventListener('keydown', (e) => e.stopPropagation());
    el.append(btn);
  }
  setAttr(btn, 'aria-label', `Set color for ${title || 'conversation'}`);
  setAttr(btn, 'title', 'Set color');
}

/** Remove everything we added to this row. */
export function undecorate(el: Element): void {
  el.removeAttribute(ID_ATTR);
  el.removeAttribute(COLOR_ATTR);
  el.classList.remove(POS_CLASS);
  positioned.delete(el);
  (el as HTMLElement).style?.removeProperty('--crc-c');
  child(el, BTN_CLASS)?.remove();
  child(el, BAR_CLASS)?.remove();
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
    else if (n instanceof Element && !n.classList.contains(BTN_CLASS) && !n.classList.contains(BAR_CLASS)) out.push(...tree(n, depth + 1));
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
  const cs = sample ? getComputedStyle(sample) : null;
  const bar = sample?.querySelector(`:scope > .${BAR_CLASS}`);
  return {
    path: maskPath(location.pathname),
    knownContainers: Object.fromEntries(ROOT_SELECTORS.map((s) => [s, !!doc.querySelector(s)])),
    root: root ? describe(root) : null,
    rows: rows.length,
    decorated: doc.querySelectorAll(`[${ID_ATTR}]`).length,
    colored: doc.querySelectorAll(`.${BAR_CLASS}`).length,
    conversationHrefShapes: Object.fromEntries([...shapes].slice(0, 12)),
    sampleRow: sample ? tree(sample) : null,
    sampleAncestry: ancestry,
    sampleRowStyle: cs && {
      position: cs.position,
      display: cs.display,
      overflow: cs.overflow,
      zIndex: cs.zIndex,
      width: Math.round(sample!.getBoundingClientRect().width),
      height: Math.round(sample!.getBoundingClientRect().height),
    },
    barStyle: bar && (() => {
      const b = getComputedStyle(bar);
      const r = bar.getBoundingClientRect();
      return { display: b.display, background: b.backgroundColor, width: Math.round(r.width), height: Math.round(r.height) };
    })(),
  };
}

export type Diagnostics = ReturnType<typeof diagnose>;
