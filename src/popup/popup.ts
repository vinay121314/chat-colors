import { matchCategory, resolveColor } from '../core/rules';
import {
  NEUTRAL,
  NONE,
  PALETTE,
  defaultSettings,
  migrate,
  newId,
  normalizeHex,
  parseImport,
  type Settings,
} from '../core/schema';
import { MSG_CURRENT, load, onChange, save, update } from '../core/storage';

type Current = { id: string | null; title: string | null } | null;

let s: Settings;
let current: Current = null;

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

/** Tiny element helper. `key` lets render() restore focus to the same logical control. */
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { key?: string; label?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const { key, label, ...rest } = props;
  const el = Object.assign(document.createElement(tag), rest);
  if (key) el.dataset.key = key;
  if (label) el.setAttribute('aria-label', label);
  el.append(...children);
  return el;
}

const btn = (text: string, onclick: () => void, props: Partial<HTMLButtonElement> & { key?: string; label?: string } = {}) =>
  h('button', { type: 'button', textContent: text, onclick, ...props });

/** Apply locally for instant UI, and to the latest stored copy so concurrent tab edits aren't lost. */
function commit(fn: (x: Settings) => void): void {
  fn(s);
  render();
  update(fn).catch((e: unknown) => setStatus(`Could not save: ${String(e)}`));
}

function setStatus(msg: string): void {
  $('io-status').textContent = msg;
}

function setOverride(id: string, v: string | null): void {
  commit((x) => {
    if (v === null) delete x.overrides[id];
    else x.overrides[id] = v;
  });
}

function swatchRow(selected: string | null, onPick: (c: string) => void, keyPrefix: string): HTMLElement {
  const row = h('div', { className: 'swatches' });
  const seen = new Set<string>();
  for (const [color, name] of [...s.categories.map((c) => [c.color, c.name]), ...PALETTE.map((c) => [c, c])] as [string, string][]) {
    if (seen.has(color)) continue;
    seen.add(color);
    const b = btn('', () => onPick(color), { className: 'sw', title: name, label: name, key: `${keyPrefix}:${color}` });
    b.style.background = color;
    b.setAttribute('aria-pressed', String(selected === color));
    row.append(b);
  }
  return row;
}

function customColor(initial: string, onApply: (c: string) => void, key: string): HTMLElement {
  const picker = h('input', { type: 'color', value: initial, label: 'Custom color', key: `${key}:picker` });
  const hex = h('input', { type: 'text', value: initial, label: 'Custom HEX color', spellcheck: false, key: `${key}:hex`, className: 'hex' });
  picker.oninput = () => {
    hex.value = picker.value;
    hex.setCustomValidity('');
  };
  const apply = () => {
    const v = normalizeHex(hex.value);
    if (!v) {
      hex.setCustomValidity('Use #rgb or #rrggbb');
      hex.reportValidity();
      return;
    }
    onApply(v);
  };
  hex.onkeydown = (e) => {
    if (e.key === 'Enter') apply();
  };
  return h('div', { className: 'row' }, picker, hex, btn('Apply', apply, { key: `${key}:apply` }));
}

function renderCurrent(): void {
  const box = $('current');
  if (!current?.id) {
    box.replaceChildren(
      h('p', {
        className: 'hint',
        textContent: current ? 'Open a conversation to color it.' : 'Open a ChatGPT conversation in this tab to color it.',
      }),
    );
    return;
  }
  const id = current.id;
  const r = resolveColor(id, current.title ?? '', s);
  const status =
    r.source === 'manual'
      ? 'Manual color'
      : current.title === null
        ? 'Automatic (title not visible in sidebar)'
        : r.source === 'rule'
          ? `Automatic: ${r.category?.name}`
          : 'Automatic: no rule matched';
  const dot = h('span', { className: 'dot' });
  dot.style.background = r.color ?? 'transparent';
  box.replaceChildren(
    h('p', { className: 'title' }, dot, current.title ?? 'Untitled / not in sidebar'),
    h('p', { className: 'hint', textContent: status }),
    swatchRow(r.source === 'manual' ? r.color : null, (c) => setOverride(id, c), 'cur'),
    customColor(r.color ?? PALETTE[1]!, (c) => setOverride(id, c), 'cur'),
    h(
      'div',
      { className: 'row' },
      btn('Reset to automatic', () => setOverride(id, null), { key: 'cur:reset' }),
      btn('Remove color', () => setOverride(id, NONE), { key: 'cur:none' }),
    ),
  );
}

function renderCategories(): void {
  const list = $('categories');
  const n = s.categories.length;
  list.replaceChildren(
    ...s.categories.map((c, i) => {
      const k = `c:${c.id}`;
      const withCat = (fn: (cat: Settings['categories'][number], x: Settings) => void) => (x: Settings) => {
        const cat = x.categories.find((y) => y.id === c.id);
        if (cat) fn(cat, x);
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
      const name = h('input', { type: 'text', value: c.name, label: 'Category name', key: `${k}:name`, className: 'name' });
      name.onchange = () => {
        const v = name.value.trim();
        if (!v) return void (name.value = c.name);
        commit(withCat((cat) => (cat.name = v.slice(0, 60))));
      };
      const enabled = h('input', { type: 'checkbox', checked: c.enabled, label: `Enable ${c.name}`, key: `${k}:enabled` });
      enabled.onchange = () => commit(withCat((cat) => (cat.enabled = enabled.checked)));

      const rules = h(
        'ul',
        { className: 'kws' },
        ...c.rules.map((r) => {
          const cb = h('input', { type: 'checkbox', checked: r.enabled, key: `${k}:kw:${r.keyword}:on` });
          cb.onchange = () =>
            commit(
              withCat((cat) => {
                const rule = cat.rules.find((y) => y.keyword === r.keyword);
                if (rule) rule.enabled = cb.checked;
              }),
            );
          return h(
            'li',
            { className: r.enabled ? '' : 'off' },
            h('label', {}, cb, r.keyword),
            btn('×', () => commit(withCat((cat) => (cat.rules = cat.rules.filter((y) => y.keyword !== r.keyword)))), {
              className: 'icon',
              label: `Remove keyword ${r.keyword}`,
              key: `${k}:kw:${r.keyword}:rm`,
            }),
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

      return h(
        'li',
        { className: c.enabled ? 'cat' : 'cat off' },
        h(
          'div',
          { className: 'row' },
          enabled,
          color,
          name,
          btn('↑', () => move(-1), { className: 'icon', label: `Move ${c.name} up`, disabled: i === 0, key: `${k}:up` }),
          btn('↓', () => move(1), { className: 'icon', label: `Move ${c.name} down`, disabled: i === n - 1, key: `${k}:down` }),
          btn(
            '×',
            () => {
              if (confirm(`Delete category "${c.name}"?`)) commit((x) => (x.categories = x.categories.filter((y) => y.id !== c.id)));
            },
            { className: 'icon danger', label: `Delete ${c.name}`, key: `${k}:del` },
          ),
        ),
        rules,
        h('div', { className: 'row' }, kw, btn('Add', addKw, { key: `${k}:addbtn` })),
      );
    }),
  );
}

function renderTest(): void {
  const t = $('test-title').value;
  const c = t.trim() ? matchCategory(t, s.categories) : undefined;
  $('test-result').textContent = !t.trim() ? '' : c ? `Matches: ${c.name}` : 'No match: Uncategorized';
}

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset.key;
  $('enabled').checked = s.enabled;
  document.body.classList.toggle('disabled', !s.enabled);
  $('fallback').value = s.fallback === NONE ? NEUTRAL : s.fallback;
  $('fallback-none').checked = s.fallback === NONE;
  for (const k of ['thickness', 'opacity', 'radius'] as const) {
    $(k).value = String(s.appearance[k]);
    $(`${k}-v`).textContent = `${s.appearance[k]}${k === 'opacity' ? '%' : 'px'}`;
  }
  renderCurrent();
  renderCategories();
  renderTest();
  if (focusKey) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus();
}

async function fetchCurrent(): Promise<Current> {
  try {
    // No "tabs" permission needed: we only use the tab id, never its URL.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined) return null;
    return ((await chrome.tabs.sendMessage(tab.id, { type: MSG_CURRENT })) as Current) ?? null;
  } catch {
    return null; // not a ChatGPT tab (no content script)
  }
}

function wire(): void {
  $('enabled').onchange = () => commit((x) => (x.enabled = $('enabled').checked));
  $('add-cat').onclick = () => {
    const id = newId();
    const color = PALETTE[s.categories.length % PALETTE.length]!;
    commit((x) => x.categories.push({ id, name: 'New category', color, enabled: true, rules: [] }));
    document.querySelector<HTMLElement>(`[data-key="c:${id}:name"]`)?.focus();
  };
  $('fallback').onchange = () => commit((x) => (x.fallback = $('fallback').value));
  $('fallback-none').onchange = () => commit((x) => (x.fallback = $('fallback-none').checked ? NONE : $('fallback').value));
  for (const k of ['thickness', 'opacity', 'radius'] as const) {
    $(k).oninput = () => commit((x) => (x.appearance[k] = Number($(k).value)));
  }
  $('test-title').oninput = renderTest;

  $('export').onclick = () => {
    const data = migrate(JSON.parse(JSON.stringify(s))); // export only what passes validation
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    h('a', { href: url, download: `chatgpt-recents-colorizer-${new Date().toISOString().slice(0, 10)}.json` }).click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setStatus('Exported.');
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
      setStatus('Imported.');
    } catch (e) {
      setStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  $('reset').onclick = async () => {
    if (!confirm('Reset all categories, colors and settings to defaults?')) return;
    s = defaultSettings();
    await save(s);
    render();
    setStatus('Reset to defaults.');
  };
}

async function init(): Promise<void> {
  [s, current] = await Promise.all([load(), fetchCurrent()]);
  wire();
  render();
  onChange((next) => {
    if (JSON.stringify(next) === JSON.stringify(s)) return; // our own echo
    s = next;
    render();
  });
}

void init();
