// Observes the sidebar and keeps row decoration in sync with settings. No chrome.* here (testable).
import { resolveColor } from '../core/rules';
import type { Appearance, Settings } from '../core/schema';
import { decorate, decorated, findRoot, findRows, getTitle, parseConversationId, undecorate, type Row } from './adapter';
import { closePicker, openPicker, type SetOverride } from './picker';

export interface Current {
  id: string | null;
  title: string | null;
}

export function createColorizer(set: SetOverride) {
  let s: Settings | null = null;
  let root: Element | null = null;
  let running = false;
  let pending = false;
  let vars: HTMLStyleElement | null = null;

  // Narrow observer: the sidebar only. Title edits (characterData), new/removed rows, recycled hrefs.
  const sidebarObs = new MutationObserver(schedule);
  // Minimal root observer, only to notice the sidebar being removed/replaced/first rendered.
  // Its callback is O(1) while the sidebar is connected.
  const bodyObs = new MutationObserver(() => {
    if (!root?.isConnected) schedule();
  });

  function schedule(): void {
    if (pending || !running) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      scan();
    });
  }

  function bind(): void {
    const next = findRoot();
    if (next === root) return;
    sidebarObs.disconnect();
    root = next;
    if (root) {
      sidebarObs.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href'],
      });
    }
  }

  const open = (btn: HTMLButtonElement, row: Row) => {
    if (s) openPicker(btn, row.id, getTitle(row.el), s, set);
  };

  function scan(): void {
    if (!running || !s) return;
    if (!root?.isConnected) bind();
    if (!root) return; // unsupported/absent sidebar: do nothing rather than guess
    const seen = new Set<Element>();
    for (const row of findRows(root)) {
      seen.add(row.el);
      const title = getTitle(row.el);
      decorate(row, resolveColor(row.id, title, s).color, title, open);
    }
    // Rows whose href no longer points at a conversation (recycled nodes) lose our decoration.
    for (const el of decorated(root)) if (!seen.has(el)) undecorate(el);
  }

  function applyVars(a: Appearance): void {
    if (!vars?.isConnected) {
      vars = document.createElement('style');
      vars.id = 'crc-vars';
      document.head.append(vars);
    }
    vars.textContent = `:root{--crc-w:${a.thickness}px;--crc-o:${a.opacity}%;--crc-r:${a.radius}px}`;
  }

  function stop(): void {
    running = false;
    pending = false;
    sidebarObs.disconnect();
    bodyObs.disconnect();
    closePicker();
    for (const el of decorated(document)) undecorate(el);
    vars?.remove();
    vars = null;
    root = null;
  }

  return {
    update(next: Settings): void {
      s = next;
      if (!next.enabled) return stop();
      applyVars(next.appearance);
      if (!running) {
        running = true;
        bodyObs.observe(document.body, { childList: true, subtree: true });
      }
      scan();
    },
    stop,
    /** Conversation in the current URL, with its sidebar title if that row is visible. */
    current(path: string = location.pathname): Current {
      const id = parseConversationId(path);
      const r = root?.isConnected ? root : findRoot();
      const row = id && r ? findRows(r).find((x) => x.id === id) : undefined;
      return { id, title: row ? getTitle(row.el) : null };
    },
  };
}
