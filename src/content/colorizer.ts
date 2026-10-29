// Observes the sidebar and keeps row decoration in sync with settings. No chrome.* here (testable).
// Purely visual: nothing interactive is injected into ChatGPT's rows. Colors are assigned in the popup.
import { resolveColor, type Source } from '../core/rules';
import { AUTO, STATUS_LABEL, chatKey, statusOf, type Settings, type Status } from '../core/schema';
import {
  activeRow,
  decorate,
  decorated,
  findGroupRows,
  findRoot,
  findRows,
  getTitle,
  kindOf,
  parseChatGroup,
  parseConversationId,
  renderFilterBar,
  setActive,
  setHidden,
  undecorate,
  type Group,
} from './adapter';

/** A color in use in the sidebar, for the popup's filter chips. */
export interface LegendEntry {
  color: string;
  label: string;
  count: number;
}

export interface GroupInfo {
  key: string;
  name: string;
  kind: string;
}

export interface Current {
  id: string | null;
  title: string | null;
  group: GroupInfo | null;
  legend: LegendEntry[];
  filter: string | null;
}

/** One sidebar conversation for the popup's Chats tab. Sent to the popup on request; never stored. */
export interface ListEntry {
  id: string;
  title: string;
  color: string | null;
  source: Source;
  /** Category or Project/GPT name the color comes from, if any. */
  label: string | null;
  group: GroupInfo | null;
  active: boolean;
  /** Working Set status (null = Unassigned). */
  status: Status | null;
}

export interface Host {
  /** Change the sidebar filter (persisted by the caller). */
  setFilter: (color: string | null) => void;
  /** A different conversation became the open one in this tab (for Recently Revisited). */
  opened?: (id: string) => void;
}

/** Does a row pass the sidebar filter? Color filter `#rrggbb`, or Working Set `status:<s|none>`. */
function passes(filter: string | null, color: string | null, status: Status | null): boolean {
  if (filter === null) return true;
  if (filter.startsWith('status:')) return (status ?? 'none') === filter.slice(7);
  return color === filter;
}

/**
 * Presenter Mode CSS: conceals titles of every decorated sidebar row (chats, Projects, GPTs).
 * Pure CSS on our own data-crc attribute; nothing is added to the rows.
 */
function presenterCss(s: Settings): string {
  const p = s.presenter;
  if (!p.enabled) return '';
  const hide =
    p.style === 'dots'
      ? '-webkit-text-security:disc!important;'
      : `filter:blur(${p.strength}px)!important;transition:filter .12s ease;`;
  const reveal = p.reveal ? '[data-crc]:hover a,[data-crc]:focus-within a{filter:none!important;-webkit-text-security:none!important}' : '';
  return `[data-crc] a{${hide}}${reveal}@media (prefers-reduced-motion:reduce){[data-crc] a{transition:none!important}}`;
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
  /** Conversation last reported as opened (so rescans don't count as visits). */
  let lastOpened: string | null = null;
  /** Navigation API (verified available live); absent in older engines / jsdom. */
  const nav = (globalThis as { navigation?: EventTarget }).navigation;

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
        attributeFilter: ['href', 'aria-current'], // aria-current: ChatGPT moving the "open chat" marker
      });
    }
  }

  const groupName = (g: Group) => groupNames.get(g.key) || s?.groups[g.key]?.name || g.slug || kindOf(g.key);
  const groupInfo = (g: Group | null): GroupInfo | null => (g ? { key: g.key, name: groupName(g), kind: kindOf(g.key) } : null);

  /** Human label for a filter value: status name, category / Project name, else the hex. */
  function labelFor(color: string): string {
    if (color.startsWith('status:')) return STATUS_LABEL[color.slice(7) as Status | 'none'] ?? color;
    if (!s) return color;
    const cat = s.categories.find((c) => c.color === color);
    if (cat) return cat.name;
    const g = Object.entries(s.groups).find(([, v]) => v.color === color);
    if (g) return groupNames.get(g[0]) || g[1].name || color;
    return color;
  }

  function scan(): void {
    if (!running || !s) return;
    if (!root?.isConnected || rowCount === 0) bind();
    if (!root) return; // unsupported/absent sidebar: do nothing rather than guess
    const seen = new Set<Element>();

    const groupRows = findGroupRows(root);
    groupNames = new Map(groupRows.map((r) => [r.group.key, getTitle(r.el)]));
    for (const r of groupRows) {
      seen.add(decorate({ el: r.el, id: `group:${r.group.key}` }, s.groups[r.group.key]?.color ?? null));
    }

    const rows = findRows(root);
    const openRow = s.appearance.highlight ? activeRow(rows) : undefined;
    rowCount = rows.length;
    const counts = new Map<string, number>();
    let shown = 0;
    let firstBox: Element | null = null;
    for (const row of rows) {
      const color = resolveColor(row.id, getTitle(row.el), s, parseChatGroup(row.el.getAttribute('href'))?.key).color;
      const box = decorate(row, color);
      firstBox ??= box;
      seen.add(box);
      const pass = passes(filter, color, statusOf(s, chatKey(row.id)));
      if (pass) shown++;
      setHidden(box, !pass);
      setActive(box, row === openRow);
      if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    // Recently Revisited: report the open conversation once per change (not on every rescan).
    const opened = parseConversationId(location.pathname);
    if (opened !== lastOpened) {
      lastOpened = opened;
      if (opened) host.opened?.(opened);
    }
    legend = [...counts].map(([color, count]) => ({ color, count, label: labelFor(color) })).sort((a, b) => b.count - a.count);

    renderFilterBar(
      firstBox,
      filter ? { color: filter.startsWith('status:') ? 'currentColor' : filter, label: labelFor(filter), count: shown } : null,
      () => host.setFilter(null),
    );
    // Rows whose href no longer points at a target (recycled nodes) lose our decoration.
    for (const el of decorated(root)) if (!seen.has(el)) undecorate(el);
  }

  function applyVars(settings: Settings): void {
    const a = settings.appearance;
    if (!vars?.isConnected) {
      vars = document.createElement('style');
      vars.id = 'crc-vars';
      document.head.append(vars);
    }
    // Outline: 'auto' leaves --crc-oc unset so CSS falls back to the row's own text color.
    const oc = a.outlineColor === AUTO ? '' : `--crc-oc:${a.outlineColor};`;
    vars.textContent =
      `:root{--crc-w:${a.thickness}px;--crc-o:${a.opacity / 100};--crc-r:${a.radius}px;--crc-f:${a.fill}%;` +
      `--crc-ow:${a.outlineWidth}px;--crc-oo:${a.outlineOpacity}%;${oc}}` +
      (a.mode === 'bar' ? '.crc-fill{display:none!important}' : '') +
      (a.mode === 'fill' ? '.crc-bar{display:none!important}' : '') +
      presenterCss(settings);
  }

  function stop(): void {
    running = false;
    pending = false;
    sidebarObs.disconnect();
    bodyObs.disconnect();
    nav?.removeEventListener('currententrychange', schedule);
    removeEventListener('popstate', schedule);
    renderFilterBar(null, null, () => {});
    for (const el of decorated(document)) undecorate(el);
    vars?.remove();
    vars = null;
    root = null;
    rowCount = 0;
  }

  const sidebar = () => (root?.isConnected ? root : findRoot());

  return {
    update(next: Settings): void {
      s = next;
      if (!next.enabled) return stop();
      applyVars(next);
      if (!running) {
        running = true;
        bodyObs.observe(document.body, { childList: true, subtree: true });
        // SPA navigation (verified: Navigation API available live). aria-current mutations also trigger.
        nav?.addEventListener('currententrychange', schedule);
        addEventListener('popstate', schedule);
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
      const r = sidebar();
      const row = id && r ? findRows(r).find((x) => x.id === id) : undefined;
      return {
        id,
        title: row ? getTitle(row.el) : null,
        group: id ? groupInfo(parseChatGroup(path)) : null,
        legend,
        filter,
      };
    },
    /** Every conversation loaded in the sidebar, for assigning colors from the popup. */
    list(path: string = location.pathname): ListEntry[] {
      const r = sidebar();
      if (!r || !s) return [];
      const rows = findRows(r);
      const open = activeRow(rows, path);
      const seen = new Set<string>();
      return rows.flatMap((row) => {
        if (seen.has(row.id)) return []; // same chat listed twice (e.g. pinned + recent)
        seen.add(row.id);
        const title = getTitle(row.el);
        const g = parseChatGroup(row.el.getAttribute('href'));
        const res = resolveColor(row.id, title, s!, g?.key);
        const gi = groupInfo(g);
        return [
          {
            id: row.id,
            title,
            color: res.color,
            source: res.source,
            label: res.source === 'rule' ? (res.category?.name ?? null) : res.source === 'group' ? (gi?.name ?? null) : null,
            group: gi,
            active: row === open,
            status: statusOf(s!, chatKey(row.id)),
          },
        ];
      });
    },
  };
}
