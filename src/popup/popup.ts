import { matchCategory, resolveColor } from '../core/rules';
import {
  NEUTRAL,
  NONE,
  PALETTE,
  addStarterKeywords,
  defaultSettings,
  migrate,
  newId,
  normalizeHex,
  parseImport,
  type Category,
  type Mode,
  type Settings,
} from '../core/schema';

const SLIDERS = ['fill', 'thickness', 'opacity', 'radius'] as const;
import { MSG_CURRENT, MSG_DIAG, load, onChange, onFilter, save, saveFilter, update } from '../core/storage';

type Current = {
  id: string | null;
  title: string | null;
  group: { key: string; name: string; kind: string } | null;
  legend: { color: string; label: string; count: number }[];
  filter: string | null;
} | null;
type Diag = { rows: number; root: string | null; [k: string]: unknown } | null;

let s: Settings;
let current: Current = null;
let diag: Diag = null;
const expanded = new Set<string>();
/** Conversation tab: color this chat only, or its whole Project/GPT. */
let scope: 'chat' | 'group' = 'chat';

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<HTMLElementTagNameMap[K]> & { key?: string; label?: string; cls?: string };

/** Tiny element helper. `key` lets render() restore focus to the same logical control. */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props<K> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const { key, label, cls, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (cls) el.className = cls;
  if (key) el.dataset.key = key;
  if (label) el.setAttribute('aria-label', label);
  el.append(...children);
  return el;
}

const btn = (text: string | Node, onclick: () => void, props: Props<'button'> = {}) =>
  h('button', { type: 'button', onclick, cls: 'btn', ...props }, text);

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Small stroke icons built with DOM APIs (no innerHTML). */
function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}
const I = {
  up: 'M8 12.5v-9M4.5 7 8 3.5 11.5 7',
  down: 'M8 3.5v9M4.5 9 8 12.5 11.5 9',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  x: 'M4 4l8 8M12 4l-8 8',
  chev: 'M6 3.5 10.5 8 6 12.5',
};

const colorVar = (el: HTMLElement, c: string | null) => {
  if (c) el.style.setProperty('--c', c);
  return el;
};

/** Apply locally for instant UI, and to the latest stored copy so concurrent tab edits aren't lost. */
function commit(fn: (x: Settings) => void): void {
  fn(s);
  render();
  update(fn).catch((e: unknown) => setNote(`Could not save: ${String(e)}`));
}

function setNote(msg: string): void {
  $('io-status').textContent = msg;
}

function setOverride(id: string, v: string | null): void {
  commit((x) => {
    if (v === null) delete x.overrides[id];
    else x.overrides[id] = v;
  });
}

// ------------------------------------------------------------------ Header status

function renderStatus(): void {
  const el = $('status');
  const [tone, text] = !diag
    ? ['idle', 'Open chatgpt.com to start']
    : !s.enabled
      ? ['idle', 'Paused']
      : diag.rows > 0
        ? ['ok', `${diag.rows} chat${diag.rows === 1 ? '' : 's'} detected`]
        : ['warn', 'Sidebar not recognized'];
  el.dataset.tone = tone;
  el.querySelector('span')!.textContent = text;
}

// ------------------------------------------------------------------ Conversation tab

function renderFilter(): HTMLElement | null {
  if (!current || (!current.legend.length && !current.filter)) return null;
  const chip = (label: string, color: string | null, count: number | null, active: boolean, key: string) => {
    const b = btn('', () => void saveFilter(color), { cls: 'chip', key });
    if (color) b.append(colorVar(h('i'), color));
    b.append(h('span', { textContent: label }));
    if (count !== null) b.append(h('span', { cls: 'n', textContent: String(count) }));
    b.setAttribute('aria-pressed', String(active));
    return b;
  };
  return h(
    'div',
    { cls: 'card' },
    h('p', { cls: 'eyebrow', textContent: 'Show in sidebar' }),
    h(
      'div',
      { cls: 'chips' },
      chip('All chats', null, null, !current.filter, 'flt:all'),
      ...current.legend.map((l) => chip(l.label, l.color, l.count, current!.filter === l.color, `flt:${l.color}`)),
    ),
  );
}

function renderCurrent(): void {
  const box = $('current');
  const filterCard = renderFilter();
  if (!current?.id) {
    const empty = h(
      'div',
      { cls: 'empty' },
      icon('M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 2.5V11h.5A1.5 1.5 0 0 1 3 9.5z'),
      h('p', { cls: 'label', textContent: current ? 'No conversation open' : 'Not on ChatGPT' }),
      h('p', {
        cls: 'sub',
        textContent: current
          ? 'Open a conversation to color it here, or use the dot on any sidebar row.'
          : 'Open chatgpt.com in this tab. Rules and style can be edited from the other tabs.',
      }),
    );
    box.replaceChildren(...(filterCard ? [filterCard] : []), empty);
    return;
  }
  const id = current.id;
  const g = current.group;
  if (!g) scope = 'chat';
  const r = resolveColor(id, current.title ?? '', s, g?.key);
  const groupColor = g ? (s.groups[g.key]?.color ?? null) : null;
  const selected = scope === 'group' ? groupColor : r.source === 'manual' ? r.color : null;
  const shown = scope === 'group' ? groupColor : r.color;
  const apply = (v: string | null) => {
    if (scope === 'group' && g) {
      commit((x) => {
        if (v === null) delete x.groups[g.key];
        else x.groups[g.key] = { color: v, name: g.name };
      });
    } else {
      setOverride(id, v);
    }
  };

  const badgeText =
    scope === 'group'
      ? groupColor
        ? `${g!.kind} color · all its chats`
        : `No ${g!.kind} color`
      : r.source === 'manual'
        ? r.color
          ? 'Manual color'
          : 'Manually uncolored'
        : r.source === 'group'
          ? `From ${g!.kind} · ${g!.name}`
          : current.title === null
            ? 'Automatic · title not in sidebar'
            : r.source === 'rule'
              ? `Automatic · ${r.category?.name}`
              : 'No color';

  const head = h(
    'div',
    { cls: 'convo-head' },
    colorVar(h('span', { cls: 'convo-bar' }), shown),
    h(
      'div',
      { cls: 'grow' },
      h('p', { cls: 'eyebrow', textContent: g ? `Open conversation · ${g.kind}: ${g.name}` : 'Open conversation' }),
      h('p', { cls: 'convo-title', textContent: current.title ?? 'Untitled conversation' }),
      h('span', { cls: 'badge' }, colorVar(h('i'), shown), badgeText),
    ),
  );

  const scopeSwitch = g
    ? h(
        'div',
        { cls: 'segmented two', role: 'radiogroup', label: 'Apply color to' },
        ...(
          [
            ['chat', 'This chat'],
            ['group', `All in ${g.kind}`],
          ] as const
        ).map(([sc, label]) => {
          const input = h('input', { type: 'radio', name: 'scope', value: sc, checked: scope === sc, key: `scope:${sc}` });
          input.onchange = () => {
            scope = sc;
            render();
          };
          return h('label', {}, input, h('span', { textContent: label }));
        }),
      )
    : null;

  const chips = h(
    'div',
    { cls: 'chips' },
    ...s.categories.map((c) => {
      const b = btn('', () => apply(c.color), { cls: 'chip', key: `cur:cat:${c.id}` });
      b.append(colorVar(h('i'), c.color), h('span', { textContent: c.name }));
      b.setAttribute('aria-pressed', String(selected === c.color));
      return b;
    }),
  );
  const swatches = h(
    'div',
    { cls: 'swatches' },
    ...PALETTE.map((c) => {
      const b = btn('', () => apply(c), { cls: 'sw', title: c, label: `Color ${c}`, key: `cur:sw:${c}` });
      b.setAttribute('aria-pressed', String(selected === c));
      return colorVar(b, c);
    }),
  );

  const initial = shown ?? PALETTE[1]!;
  const picker = h('input', { type: 'color', value: initial, label: 'Custom color', key: 'cur:picker' });
  const hex = h('input', { type: 'text', value: initial, label: 'Custom HEX color', spellcheck: false, key: 'cur:hex', cls: 'mono' });
  picker.oninput = () => {
    hex.value = picker.value;
    hex.setCustomValidity('');
  };
  const applyHex = () => {
    const v = normalizeHex(hex.value);
    if (!v) {
      hex.setCustomValidity('Use #rgb or #rrggbb');
      hex.reportValidity();
      return;
    }
    apply(v);
  };
  hex.onkeydown = (e) => {
    if (e.key === 'Enter') applyHex();
  };

  const actions =
    scope === 'group'
      ? [btn(`Clear ${g!.kind} color`, () => apply(null), { cls: 'btn ghost', key: 'cur:reset' })]
      : [
          btn('Reset to automatic', () => apply(null), { cls: 'btn ghost', key: 'cur:reset' }),
          btn('Remove color', () => setOverride(id, NONE), { cls: 'btn ghost', key: 'cur:none' }),
        ];

  const card = h(
    'div',
    { cls: 'card' },
    ...(scopeSwitch ? [scopeSwitch] : []),
    ...(s.categories.length ? [h('div', {}, h('p', { cls: 'eyebrow', textContent: 'Categories' }), chips)] : []),
    h('div', {}, h('p', { cls: 'eyebrow', textContent: 'Colors' }), swatches),
    h(
      'div',
      {},
      h('p', { cls: 'eyebrow', textContent: 'Custom' }),
      h('div', { cls: 'custom' }, h('label', { cls: 'well' }, picker), hex, btn('Apply', applyHex, { cls: 'btn primary', key: 'cur:apply' })),
    ),
    h('div', { cls: 'actions' }, ...actions),
  );
  box.replaceChildren(h('div', { cls: 'card' }, head), card, ...(filterCard ? [filterCard] : []));
}

function renderGroups(): void {
  const entries = Object.entries(s.groups);
  $('groups-card').hidden = entries.length === 0;
  $('groups').replaceChildren(
    ...entries.map(([key, gc]) => {
      const color = h('input', { type: 'color', value: gc.color, label: `${gc.name || key} color`, key: `g:${key}:color` });
      color.onchange = () =>
        commit((x) => {
          const e = x.groups[key];
          if (e) e.color = color.value;
        });
      return h(
        'li',
        { cls: 'group-row' },
        h('label', { cls: 'well sm' }, color),
        h(
          'div',
          { cls: 'grow' },
          h('p', { cls: 'label', textContent: gc.name || key }),
          h('p', { cls: 'sub', textContent: key.startsWith('g-p-') ? 'Project · all chats' : 'Custom GPT · all chats' }),
        ),
        h(
          'button',
          {
            type: 'button',
            cls: 'icon-btn danger',
            label: `Remove color for ${gc.name || key}`,
            key: `g:${key}:rm`,
            onclick: () => commit((x) => delete x.groups[key]),
          },
          icon(I.trash),
        ),
      );
    }),
  );
}

// ------------------------------------------------------------------ Rules tab

function renderCategories(): void {
  $('rules-hint').hidden = s.categories.some((c) => c.rules.length > 0);
  const n = s.categories.length;
  $('categories').replaceChildren(...s.categories.map((c, i) => categoryItem(c, i, n)));
}

function categoryItem(c: Category, i: number, n: number): HTMLLIElement {
  const k = `c:${c.id}`;
  const open = expanded.has(c.id);
  const withCat = (fn: (cat: Category) => void) => (x: Settings) => {
    const cat = x.categories.find((y) => y.id === c.id);
    if (cat) fn(cat);
  };
  const move = (d: number) =>
    commit((x) => {
      const a = x.categories.findIndex((y) => y.id === c.id);
      const b = a + d;
      if (a < 0 || b < 0 || b >= x.categories.length) return;
      [x.categories[a], x.categories[b]] = [x.categories[b]!, x.categories[a]!];
    });

  const color = h('input', { type: 'color', value: c.color, label: `${c.name} color`, key: `${k}:color` });
  color.onchange = () => commit(withCat((cat) => (cat.color = color.value)));
  const enabled = h('input', { type: 'checkbox', checked: c.enabled, label: `Enable ${c.name}`, key: `${k}:enabled`, cls: 'switch sm' });
  enabled.setAttribute('role', 'switch');
  enabled.onchange = () => commit(withCat((cat) => (cat.enabled = enabled.checked)));

  const on = c.rules.filter((r) => r.enabled).length;
  const toggle = h(
    'button',
    { type: 'button', cls: 'cat-toggle', key: `${k}:toggle`, label: c.name },
    h('span', { cls: 'name', textContent: c.name }),
    h('span', { cls: 'count', textContent: `${on}${on === c.rules.length ? '' : `/${c.rules.length}`} keyword${c.rules.length === 1 ? '' : 's'}` }),
  );
  const chev = icon(I.chev);
  chev.setAttribute('class', 'chev');
  toggle.prepend(chev);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.onclick = () => {
    if (open) expanded.delete(c.id);
    else expanded.add(c.id);
    render();
  };

  const li = h(
    'li',
    { cls: c.enabled ? 'cat' : 'cat off' },
    h('div', { cls: 'cat-row' }, h('span', { cls: 'prio', textContent: String(i + 1) }), h('label', { cls: 'well sm' }, color), toggle, enabled),
  );
  if (!open) return li;

  const name = h('input', { type: 'text', value: c.name, label: 'Category name', key: `${k}:name`, cls: 'name-input' });
  name.onchange = () => {
    const v = name.value.trim();
    if (!v) return void (name.value = c.name);
    commit(withCat((cat) => (cat.name = v.slice(0, 60))));
  };

  const kws = h(
    'ul',
    { cls: 'kws' },
    ...c.rules.map((r) => {
      const cb = h('input', { type: 'checkbox', checked: r.enabled, cls: 'sr', key: `${k}:kw:${r.keyword}:on` });
      cb.onchange = () =>
        commit(
          withCat((cat) => {
            const rule = cat.rules.find((y) => y.keyword === r.keyword);
            if (rule) rule.enabled = cb.checked;
          }),
        );
      return colorVar(
        h(
          'li',
          { cls: 'kw' },
          h('label', {}, cb, r.keyword),
          h(
            'button',
            {
              type: 'button',
              label: `Remove keyword ${r.keyword}`,
              key: `${k}:kw:${r.keyword}:rm`,
              onclick: () => commit(withCat((cat) => (cat.rules = cat.rules.filter((y) => y.keyword !== r.keyword)))),
            },
            icon(I.x),
          ),
        ),
        c.color,
      );
    }),
  );

  const kw = h('input', { type: 'text', placeholder: 'Add keywords, comma-separated', label: `Add keyword to ${c.name}`, key: `${k}:add` });
  const addKw = () => {
    const words = kw.value.split(',').map((w) => w.trim().slice(0, 100)).filter(Boolean);
    if (!words.length) return;
    commit(
      withCat((cat) => {
        for (const w of words) {
          if (!cat.rules.some((y) => y.keyword.toLowerCase() === w.toLowerCase())) cat.rules.push({ keyword: w, enabled: true });
        }
      }),
    );
  };
  kw.onkeydown = (e) => {
    if (e.key === 'Enter') addKw();
  };

  const tool = (d: string, label: string, onclick: () => void, extra: Props<'button'> = {}) =>
    h('button', { type: 'button', cls: 'icon-btn', label, title: label, onclick, ...extra }, icon(d));

  li.append(
    h(
      'div',
      { cls: 'cat-body' },
      name,
      ...(c.rules.length ? [kws] : []),
      h('div', { cls: 'kw-add' }, kw, btn('Add', addKw, { key: `${k}:addbtn` })),
      h(
        'div',
        { cls: 'cat-tools' },
        tool(I.up, `Move ${c.name} up`, () => move(-1), { disabled: i === 0, key: `${k}:up` }),
        tool(I.down, `Move ${c.name} down`, () => move(1), { disabled: i === n - 1, key: `${k}:down` }),
        h('span', { cls: 'grow' }),
        tool(
          I.trash,
          `Delete ${c.name}`,
          () => {
            if (confirm(`Delete category "${c.name}"?`)) commit((x) => (x.categories = x.categories.filter((y) => y.id !== c.id)));
          },
          { cls: 'icon-btn danger', key: `${k}:del` },
        ),
      ),
    ),
  );
  return li;
}

function renderTest(): void {
  const t = $('test-title').value.trim();
  const out = $('test-result');
  if (!t) return void out.replaceChildren();
  const c = matchCategory(t, s.categories);
  out.replaceChildren(colorVar(h('i'), c?.color ?? (s.fallback === NONE ? null : s.fallback)), c ? c.name : 'Uncategorized');
}

// ------------------------------------------------------------------ Style tab

function renderPreview(): void {
  const a = s.appearance;
  const color = (i: number) => s.categories[i]?.color ?? PALETTE[i]!;
  const rows: [string, string | null, boolean][] = [
    ['Fix TypeScript bug in parser', color(1), true],
    ['Client meeting notes', color(0), false],
    ['Weeknight recipe ideas', color(3), false],
    ['Hello there', s.fallback === NONE ? null : s.fallback, false],
  ];
  const p = $('preview');
  p.style.cssText = `--w:${a.thickness}px;--o:${a.opacity / 100};--rad:${a.radius}px;--f:${a.fill}%`;
  p.dataset.mode = a.mode;
  p.replaceChildren(
    h('p', { cls: 'p-label', textContent: 'Preview' }),
    ...rows.map(([t, c, sel]) =>
      colorVar(h('div', { cls: sel ? 'p-row sel' : 'p-row' }, ...(c ? [h('i'), h('b')] : []), h('span', { textContent: t })), c),
    ),
  );
  for (const el of document.querySelectorAll<HTMLElement>('.slider[data-for]')) {
    el.classList.toggle('off', a.mode !== 'both' && a.mode !== el.dataset.for);
  }
}

// ------------------------------------------------------------------ Data tab

function renderDiag(): void {
  const summary = $('diag-summary');
  const copy = $<HTMLButtonElement>('diag-copy');
  const details = $<HTMLDetailsElement>('diag-details');
  copy.disabled = !diag;
  details.hidden = !diag;
  if (!diag) return;
  summary.textContent = diag.rows > 0 ? `Working: ${diag.rows} conversations detected in the sidebar.` : 'No conversations detected in the sidebar.';
  $('diag-pre').textContent = JSON.stringify(diag, null, 2);
}

// ------------------------------------------------------------------ Render + wiring

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset.key;
  $('enabled').checked = s.enabled;
  document.body.classList.toggle('disabled', !s.enabled);
  $('fallback').value = s.fallback === NONE ? NEUTRAL : s.fallback;
  $('fallback-on').checked = s.fallback !== NONE;
  for (const k of SLIDERS) {
    $(k).value = String(s.appearance[k]);
    $(`${k}-v`).textContent = `${s.appearance[k]}${k === 'opacity' || k === 'fill' ? '%' : 'px'}`;
  }
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) r.checked = r.value === s.appearance.mode;
  renderStatus();
  renderCurrent();
  renderGroups();
  renderCategories();
  renderTest();
  renderPreview();
  renderDiag();
  if (focusKey) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
}

async function ask<T>(type: string): Promise<T | null> {
  try {
    // No "tabs" permission needed: we only use the tab id, never its URL.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    return ((await chrome.tabs.sendMessage(tab.id, { type })) as T) ?? null;
  } catch {
    return null; // not a ChatGPT tab (no content script)
  }
}

function wireTabs(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (t: HTMLButtonElement, focus = false) => {
    for (const x of tabs) {
      const on = x === t;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;
      $(x.getAttribute('aria-controls')!).hidden = !on;
    }
    if (focus) t.focus();
  };
  for (const t of tabs) {
    t.onclick = () => select(t);
    t.onkeydown = (e) => {
      const i = tabs.indexOf(t);
      const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
      if (next) {
        e.preventDefault();
        select(next, true);
      }
    };
  }
}

function wire(): void {
  wireTabs();
  $('version').textContent = chrome.runtime.getManifest().version;
  $('enabled').onchange = () => commit((x) => (x.enabled = $('enabled').checked));
  $('add-cat').onclick = () => {
    const id = newId();
    const color = PALETTE[s.categories.length % PALETTE.length]!;
    expanded.add(id);
    commit((x) => x.categories.push({ id, name: 'New category', color, enabled: true, rules: [] }));
    const name = document.querySelector<HTMLInputElement>(`[data-key="c:${id}:name"]`);
    name?.focus();
    name?.select();
  };
  $('load-starter').onclick = () => commit((x) => void addStarterKeywords(x));
  $('fallback').onchange = () => commit((x) => (x.fallback = $('fallback').value));
  $('fallback-on').onchange = () => commit((x) => (x.fallback = $('fallback-on').checked ? $('fallback').value : NONE));
  for (const k of SLIDERS) {
    $(k).oninput = () => commit((x) => (x.appearance[k] = Number($(k).value)));
  }
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
    r.onchange = () => commit((x) => (x.appearance.mode = r.value as Mode));
  }
  $('test-title').oninput = renderTest;

  $('export').onclick = () => {
    const data = migrate(JSON.parse(JSON.stringify(s))); // export only what passes validation
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: `chatgpt-recents-colorizer-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setNote('Exported.');
  };
  $('import-btn').onclick = () => $('import').click();
  $('import').onchange = async () => {
    const input = $('import');
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const next = parseImport(await file.text());
      const n = Object.keys(next.overrides).length;
      if (!confirm(`Replace current settings with ${next.categories.length} categories and ${n} manual colors?`)) return;
      s = next;
      await save(s);
      render();
      setNote('Imported.');
    } catch (e) {
      setNote(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  $('reset').onclick = async () => {
    if (!confirm('Reset all categories, colors and settings to defaults?')) return;
    s = defaultSettings();
    expanded.clear();
    await save(s);
    render();
    setNote('Reset to defaults.');
  };
  $('diag-copy').onclick = async () => {
    diag = await ask<Diag>(MSG_DIAG); // fresh snapshot
    render();
    const text = JSON.stringify(diag, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      $('diag-copy').textContent = 'Copied';
    } catch {
      $<HTMLDetailsElement>('diag-details').open = true; // let the user copy it manually
    }
    setTimeout(() => ($('diag-copy').textContent = 'Copy diagnostics'), 1500);
  };
}

async function init(): Promise<void> {
  [s, current, diag] = await Promise.all([load(), ask<Current>(MSG_CURRENT), ask<Diag>(MSG_DIAG)]);
  wire();
  render();
  onChange(async (next) => {
    if (JSON.stringify(next) === JSON.stringify(s)) return; // our own echo
    s = next;
    current = (await ask<Current>(MSG_CURRENT)) ?? current; // colors in use may have changed
    render();
  });
  onFilter(async (f) => {
    if (current) current.filter = f;
    current = (await ask<Current>(MSG_CURRENT)) ?? current;
    render();
  });
}

void init();
