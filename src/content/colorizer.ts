// Observes the sidebar and keeps row decoration in sync with settings. No chrome.* here (testable).
import { resolveColor } from '../core/rules';
import type { Appearance, Settings } from '../core/schema';
import {
  decorate,
  decorated,
  findGroupRows,
  findRoot,
  findRows,
  getTitle,
  kindOf,
  parseChatGroup,
  parseConversationId,
  parseGroupLink,
  renderFilterBar,
  setHidden,
  undecorate,
  type Group,
  type Row,
} from './adapter';
import { closePicker, openPicker, type PickTarget } from './picker';

/** A color in use in the sidebar, for the popup's filter chips. */
export interface LegendEntry {
  color: string;
  label: string;
  count: number;
}

export interface Current {
  id: string | null;
  title: string | null;
  group: { key: string; name: string; kind: string } | null;
  legend: LegendEntry[];
  filter: string | null;
}

export interface Host {
  /** Apply a settings mutation (persisted by the caller). */
  write: (fn: (s: Settings) => void) => void;
  setFilter: (color: string | null) => void;
}

export function createColorizer(host: Host) {
  let s: Settings | null = null;
  let filter: string | null = null;
  let root: Element | null = null;
  let running = false;
  let pending = false;
  let vars: HTMLStyleElement | null = null;
  let rowCount = 0;
  /** Group key -> name as shown in the sidebar (Project / GPT entries), refreshed every scan. */
  let groupNames = new Map<string, string>();
  let legend: LegendEntry[] = [];

  // Narrow observer: the sidebar only. Title edits (characterData), new/removed rows, recycled hrefs.
  const sidebarObs = new MutationObserver(schedule);
  // Minimal root observer, only to notice the sidebar being removed/replaced/first rendered, or
  // conversation links appearing outside the container we picked. O(1) once rows are found.
  const bodyObs = new MutationObserver(() => {
    if (!root?.isConnected || rowCount === 0) schedule();
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

  const groupName = (g: Group) => groupNames.get(g.key) || s?.groups[g.key]?.name || g.slug || kindOf(g.key);

  /** Human label for a color: category / Project name, else the hex. */
  function labelFor(color: string): string {
    if (!s) return color;
    const cat = s.categories.find((c) => c.color === color);
    if (cat) return cat.name;
    const g = Object.entries(s.groups).find(([, v]) => v.color === color);
    if (g) return groupNames.get(g[0]) || g[1].name || color;
    return color;
  }

  const open = (btn: HTMLButtonElement, row: Row) => {
    if (!s) return;
    const href = row.el.getAttribute('href');
    const id = parseConversationId(href);
    const g = id ? parseChatGroup(href) : parseGroupLink(href);
    const target: PickTarget = {
      id,
      title: getTitle(row.el),
      group: g ? { key: g.key, name: groupName(g), kind: kindOf(g.key) } : null,
    };
    openPicker(btn, target, s, (scope, value) => {
      if (scope === 'chat' && id) {
        host.write((x) => {
          if (value === null) delete x.overrides[id];
          else x.overrides[id] = value;
        });
      } else if (scope === 'group' && target.group) {
        const { key, name } = target.group;
        host.write((x) => {
          if (value === null) delete x.groups[key];
          else x.groups[key] = { color: value, name };
        });
      } else if (scope === 'filter') {
        host.setFilter(value);
      }
    });
  };

  function scan(): void {
    if (!running || !s) return;
    if (!root?.isConnected || rowCount === 0) bind();
    if (!root) return; // unsupported/absent sidebar: do nothing rather than guess
    const seen = new Set<Element>();

    const groupRows = findGroupRows(root);
    groupNames = new Map(groupRows.map((r) => [r.group.key, getTitle(r.el)]));
    for (const r of groupRows) {
      const title = getTitle(r.el);
      seen.add(decorate({ el: r.el, id: `group:${r.group.key}` }, s.groups[r.group.key]?.color ?? null, title, open));
    }

    const rows = findRows(root);
    rowCount = rows.length;
    const counts = new Map<string, number>();
    let firstBox: Element | null = null;
    for (const row of rows) {
      const title = getTitle(row.el);
      const color = resolveColor(row.id, title, s, parseChatGroup(row.el.getAttribute('href'))?.key).color;
      const box = decorate(row, color, title, open);
      firstBox ??= box;
      seen.add(box);
      setHidden(box, filter !== null && color !== filter);
      if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    legend = [...counts].map(([color, count]) => ({ color, count, label: labelFor(color) })).sort((a, b) => b.count - a.count);

    renderFilterBar(
      firstBox,
      filter ? { color: filter, label: labelFor(filter), count: counts.get(filter) ?? 0 } : null,
      () => host.setFilter(null),
    );
    // Rows whose href no longer points at a target (recycled nodes) lose our decoration.
    for (const el of decorated(root)) if (!seen.has(el)) undecorate(el);
  }

  function applyVars(a: Appearance): void {
    if (!vars?.isConnected) {
      vars = document.createElement('style');
      vars.id = 'crc-vars';
      document.head.append(vars);
    }
    vars.textContent =
      `:root{--crc-w:${a.thickness}px;--crc-o:${a.opacity / 100};--crc-r:${a.radius}px;--crc-f:${a.fill}%}` +
      (a.mode === 'bar' ? '.crc-fill{display:none!important}' : '') +
      (a.mode === 'fill' ? '.crc-bar{display:none!important}' : '');
  }

  function stop(): void {
    running = false;
    pending = false;
    sidebarObs.disconnect();
    bodyObs.disconnect();
    closePicker();
    renderFilterBar(null, null, () => {});
    for (const el of decorated(document)) undecorate(el);
    vars?.remove();
    vars = null;
    root = null;
    rowCount = 0;
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
    setFilter(next: string | null): void {
      filter = next;
      scan();
    },
    stop,
    /** Conversation in the current URL, with its sidebar title if visible, plus the color legend. */
    current(path: string = location.pathname): Current {
      const id = parseConversationId(path);
      const r = root?.isConnected ? root : findRoot();
      const row = id && r ? findRows(r).find((x) => x.id === id) : undefined;
      const g = id ? parseChatGroup(path) : null;
      return {
        id,
        title: row ? getTitle(row.el) : null,
        group: g ? { key: g.key, name: groupName(g), kind: kindOf(g.key) } : null,
        legend,
        filter,
      };
    },
  };
}
