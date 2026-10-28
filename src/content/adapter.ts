// The ONLY module that knows ChatGPT's DOM. Keep selectors here.
//
// Verified live (2026-10-28, logged-out page): the sidebar is `aside#ds-sidebar` containing
// `nav[data-slot="sidebar-history"][aria-label="Chat history"]`; class names are atomic/generated (unusable).
// UNVERIFIED (needs logged-in session): conversation rows are `<a href="/c/<uuid>">` or
// `<a href="/g/<gizmo>/c/<uuid>">` inside that sidebar, with the title as the anchor's text.

const ROOT_SELECTORS = ['#ds-sidebar', 'nav[data-slot="sidebar-history"]', 'nav[aria-label="Chat history"]'];
const CONV_PATH = /^\/(?:g\/[^/]+\/)?c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

export const ID_ATTR = 'data-crc';
export const COLOR_ATTR = 'data-crc-color';
const BTN_CLASS = 'crc-btn';
const POS_CLASS = 'crc-pos';

export interface Row {
  el: HTMLAnchorElement;
  id: string;
}

export function findRoot(doc: Document = document): Element | null {
  for (const s of ROOT_SELECTORS) {
    const el = doc.querySelector(s);
    if (el) return el;
  }
  return null;
}

/** Conversation UUID from a relative or chatgpt.com href; null for anything else. */
export function parseConversationId(href: string | null): string | null {
  if (!href) return null;
  const m = /^(?:https:\/\/chatgpt\.com)?(\/[^?#]*)/.exec(href);
  const id = m?.[1] ? CONV_PATH.exec(m[1])?.[1] : undefined;
  return id ? id.toLowerCase() : null;
}

export function findRows(root: ParentNode): Row[] {
  const rows: Row[] = [];
  for (const el of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
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

/**
 * Idempotent: writes only what changed, creates at most one control per row.
 * Our writes are attributes the observer doesn't watch, plus one child insert per row, so no feedback loop.
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
  if (color) {
    if (el.style.getPropertyValue('--crc-c') !== color) el.style.setProperty('--crc-c', color);
  } else if (el.style.getPropertyValue('--crc-c')) {
    el.style.removeProperty('--crc-c');
  }
  if (!onOpen) return;
  let btn = el.querySelector<HTMLButtonElement>(`:scope > .${BTN_CLASS}`);
  if (!btn) {
    // Absolute positioning needs a positioned row; static -> relative does not move anything.
    if (getComputedStyle(el).position === 'static') el.classList.add(POS_CLASS);
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    const b = btn;
    // Stop at the button so the anchor never navigates and ChatGPT's root-delegated handlers never see it.
    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('mousedown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      block(e);
      const a = b.parentElement;
      const rid = a?.getAttribute(ID_ATTR);
      if (a instanceof HTMLAnchorElement && rid) onOpen(b, { el: a, id: rid });
    });
    // Native <button> turns Enter/Space into click; just keep the keys away from ChatGPT's shortcuts.
    b.addEventListener('keydown', (e) => e.stopPropagation());
    el.append(btn);
  }
  setAttr(btn, 'aria-label', `Set color for ${title || 'conversation'}`);
}

/** Remove everything we added to this row. */
export function undecorate(el: Element): void {
  el.removeAttribute(ID_ATTR);
  el.removeAttribute(COLOR_ATTR);
  el.classList.remove(POS_CLASS);
  (el as HTMLElement).style?.removeProperty('--crc-c');
  el.querySelector(`:scope > .${BTN_CLASS}`)?.remove();
}

export function decorated(root: ParentNode): Element[] {
  return [...root.querySelectorAll(`[${ID_ATTR}]`)];
}
