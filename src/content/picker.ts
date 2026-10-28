// In-page color picker. Lives in a shadow root (page CSS can't reach it) and uses the
// native popover API for light-dismiss and Esc handling. Theme follows ChatGPT's actual background.
import { resolveColor } from '../core/rules';
import { NONE, PALETTE, normalizeHex, type Settings } from '../core/schema';

/** What the picker edits: a chat (maybe inside a Project/GPT), or a Project/GPT entry itself (id null). */
export interface PickTarget {
  id: string | null;
  title: string;
  group: { key: string; name: string; kind: string } | null;
}
/** scope 'chat' = this conversation, 'group' = whole Project/GPT, 'filter' = sidebar filter. */
export type Apply = (scope: 'chat' | 'group' | 'filter', value: string | null) => void;

const CSS = `
:host { all: initial; }
[popover] {
  --bg: #ffffff; --fg: #18181b; --muted: #71717a; --line: #e4e4e7; --soft: #f4f4f5; --ring: #18181b;
  --shadow: 0 1px 2px rgb(0 0 0 / .06), 0 12px 32px -8px rgb(0 0 0 / .22);
  margin: 0; inset: auto; position: fixed; box-sizing: border-box; width: 264px; padding: 0;
  border: 1px solid var(--line); border-radius: 14px; background: var(--bg); color: var(--fg);
  box-shadow: var(--shadow); overflow: hidden;
  font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
}
[popover][data-theme="dark"] {
  --bg: #1f1f22; --fg: #f4f4f5; --muted: #a1a1aa; --line: #34343a; --soft: #2a2a2f; --ring: #f4f4f5;
  --shadow: 0 1px 2px rgb(0 0 0 / .4), 0 16px 40px -8px rgb(0 0 0 / .6);
}
@media (prefers-reduced-motion: no-preference) {
  [popover]:popover-open { animation: in .14s ease-out; }
  @keyframes in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
}
* { box-sizing: border-box; }
header { padding: 12px 14px 10px; border-bottom: 1px solid var(--line); }
.eyebrow { font-size: 10.5px; font-weight: 600; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
.title { margin: 0; font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.status { display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; color: var(--muted); }
.status i { width: 8px; height: 8px; border-radius: 50%; background: var(--c, transparent); box-shadow: inset 0 0 0 1px rgb(127 127 127 / .35); }
.body { padding: 10px 14px 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
.chips { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.chip { all: unset; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; font-size: 12.5px; min-width: 0; }
.chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chip i { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
.chip:hover { background: var(--soft); }
.chip[aria-pressed="true"] { background: var(--soft); box-shadow: inset 0 0 0 1px var(--line); font-weight: 600; }
.swatches { display: grid; grid-template-columns: repeat(8, 22px); justify-content: space-between; }
.sw { all: unset; width: 22px; height: 22px; border-radius: 50%; background: var(--c); cursor: pointer; display: grid; place-items: center; transition: transform .1s; }
.sw:hover { transform: scale(1.12); }
.sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--c); }
.sw[aria-pressed="true"]::after { content: ""; width: 8px; height: 4px; border: solid #fff; border-width: 0 0 2px 2px; transform: translateY(-1px) rotate(-45deg); }
.custom { display: flex; gap: 6px; align-items: center; }
.well { position: relative; flex: none; width: 30px; height: 30px; border-radius: 8px; overflow: hidden; box-shadow: inset 0 0 0 1px var(--line); }
.well input { position: absolute; inset: -8px; width: 46px; height: 46px; border: 0; padding: 0; cursor: pointer; background: none; }
input[type=text] { flex: 1; min-width: 0; height: 30px; padding: 0 9px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--fg); font: 12.5px ui-monospace, "Cascadia Code", Consolas, monospace; }
input[type=text]:focus { outline: none; border-color: var(--ring); }
.btn { all: unset; height: 30px; padding: 0 11px; border-radius: 8px; font-size: 12.5px; font-weight: 500; cursor: pointer; display: inline-flex; align-items: center; }
.btn.primary { background: var(--fg); color: var(--bg); }
.btn.primary:hover { opacity: .88; }
.btn.ghost { color: var(--muted); }
.btn.ghost:hover { background: var(--soft); color: var(--fg); }
.seg { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 3px; padding: 3px; margin-top: 10px; border-radius: 9px; background: var(--soft); }
.seg button { all: unset; height: 26px; border-radius: 7px; text-align: center; font-size: 12px; font-weight: 500; color: var(--muted); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 6px; }
.seg button[aria-pressed="true"] { background: var(--bg); color: var(--fg); box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
.filter { all: unset; display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 7px 8px; border-radius: 8px; font-size: 12.5px; color: var(--muted); cursor: pointer; }
.filter:hover { background: var(--soft); color: var(--fg); }
.filter i { width: 10px; height: 10px; border-radius: 50%; background: var(--c); }
footer { display: flex; justify-content: space-between; padding: 6px 8px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--soft) 55%, var(--bg)); }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
`;

let host: HTMLElement | null = null;
let pop: HTMLElement;
let trigger: HTMLElement | null = null;

function ensure(): void {
  if (host?.isConnected) return;
  host = document.createElement('div');
  host.id = 'crc-picker-host';
  // 'open' only so tests can reach in; closed would add no real protection from page scripts.
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  pop = document.createElement('div');
  pop.popover = 'auto';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Conversation color');
  // beforetoggle fires while focus is still inside; by 'toggle' it has already fallen back to <body>.
  pop.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState !== 'closed') return;
    trigger?.setAttribute('aria-expanded', 'false');
    // Return focus only if it was inside the picker (Esc / choosing a color), not on click-away.
    if (document.activeElement === host) trigger?.focus();
    trigger = null;
  });
  shadow.append(style, pop);
  document.body.append(host);
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** ChatGPT's real theme: luminance of the first opaque background behind the row (any CSS color syntax). */
let probe: CanvasRenderingContext2D | null = null;
function isDark(from: Element): boolean {
  probe ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  for (let n: Element | null = from; n && probe; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') continue;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = c;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data as unknown as [number, number, number, number];
    if (a < 128) continue;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}


export function openPicker(btn: HTMLElement, target: PickTarget, s: Settings, apply: Apply): void {
  ensure();
  trigger = btn;
  pop.dataset.theme = isDark(btn) ? 'dark' : 'light';
  let scope: 'chat' | 'group' = target.id ? 'chat' : 'group';

  const render = () => {
    const choose = (v: string | null) => {
      pop.hidePopover();
      apply(scope, v);
    };
    const groupColor = target.group ? (s.groups[target.group.key]?.color ?? null) : null;
    const cur = target.id ? resolveColor(target.id, target.title, s, target.group?.key) : null;
    // What "selected" means depends on scope: the manual color, or the Project/GPT color.
    const selected = scope === 'group' ? groupColor : cur?.source === 'manual' ? cur.color : null;
    const shown = scope === 'group' ? groupColor : (cur?.color ?? null);

    const head = el('header');
    const status = el('div', 'status');
    const dot = el('i');
    if (shown) dot.style.setProperty('--c', shown);
    const g = target.group;
    status.append(
      dot,
      scope === 'group'
        ? groupColor
          ? `${g?.kind} color · applies to all its chats`
          : `No ${g?.kind} color`
        : cur?.source === 'manual'
          ? cur.color
            ? 'Manual color'
            : 'Manually uncolored'
          : cur?.source === 'group'
            ? `From ${g?.kind} · ${g?.name}`
            : cur?.source === 'rule'
              ? `Auto · ${cur.category?.name}`
              : 'No color',
    );
    head.append(
      el('p', 'eyebrow', scope === 'group' ? `${g?.kind} color` : 'Conversation color'),
      el('p', 'title', scope === 'group' ? g?.name || 'Untitled' : target.title || 'Untitled conversation'),
      status,
    );
    if (target.id && g) {
      // Scope switch: this chat only, or every chat in its Project/GPT.
      const seg = el('div', 'seg');
      for (const [sc, label] of [
        ['chat', 'This chat'],
        ['group', `All in ${g.kind}`],
      ] as const) {
        const b = button(label, '', () => {
          scope = sc;
          render();
          pop.querySelector<HTMLElement>('.seg [aria-pressed="true"]')?.focus();
        });
        b.setAttribute('aria-pressed', String(scope === sc));
        seg.append(b);
      }
      head.append(seg);
    }

    const body = el('div', 'body');
    if (s.categories.length) {
      const chips = el('div', 'chips');
      for (const c of s.categories) {
        const b = button('', 'chip', () => choose(c.color));
        const i = el('i');
        i.style.setProperty('--c', c.color);
        b.append(i, el('span', '', c.name));
        b.setAttribute('aria-pressed', String(selected === c.color));
        chips.append(b);
      }
      const sec = el('div');
      sec.append(el('p', 'eyebrow', 'Categories'), chips);
      body.append(sec);
    }

    const swatches = el('div', 'swatches');
    for (const c of PALETTE) {
      const b = button('', 'sw', () => choose(c));
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', `Color ${c}`);
      b.title = c;
      b.setAttribute('aria-pressed', String(selected === c));
      swatches.append(b);
    }
    const colors = el('div');
    colors.append(el('p', 'eyebrow', 'Colors'), swatches);

    const well = el('label', 'well');
    const picker = el('input');
    picker.type = 'color';
    picker.value = shown ?? PALETTE[1]!;
    picker.setAttribute('aria-label', 'Custom color');
    well.append(picker);
    const hex = el('input');
    hex.type = 'text';
    hex.value = picker.value;
    hex.spellcheck = false;
    hex.setAttribute('aria-label', 'Custom HEX color');
    picker.addEventListener('input', () => {
      hex.value = picker.value;
      hex.setCustomValidity('');
    });
    const applyHex = () => {
      const v = normalizeHex(hex.value);
      if (!v) {
        hex.setCustomValidity('Use #rgb or #rrggbb');
        hex.reportValidity();
        return;
      }
      choose(v);
    };
    hex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyHex();
    });
    const custom = el('div', 'custom');
    custom.append(well, hex, button('Apply', 'btn primary', applyHex));
    const customSec = el('div');
    customSec.append(el('p', 'eyebrow', 'Custom'), custom);
    body.append(colors, customSec);

    if (shown) {
      // Feature: show only chats with this color in the sidebar.
      const f = button('', 'filter', () => {
        pop.hidePopover();
        apply('filter', shown);
      });
      const i = el('i');
      i.style.setProperty('--c', shown);
      f.append(i, 'Show only chats with this color');
      body.append(f);
    }

    const foot = el('footer');
    if (scope === 'group') {
      foot.append(button(`Clear ${g?.kind} color`, 'btn ghost', () => choose(null)));
    } else {
      foot.append(button('Reset to automatic', 'btn ghost', () => choose(null)), button('Remove color', 'btn ghost', () => choose(NONE)));
    }
    pop.replaceChildren(head, body, foot);
    return body;
  };

  const body = render();
  if (!pop.matches(':popover-open')) pop.showPopover();
  // Position after showing so the real height is known; flip above the row if it would overflow.
  const r = btn.getBoundingClientRect();
  const h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(r.left - 120, innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = `${r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`;
  btn.setAttribute('aria-expanded', 'true');
  (body.querySelector<HTMLElement>('[aria-pressed="true"]') ?? body.querySelector<HTMLElement>('button'))?.focus();
}

export function closePicker(): void {
  if (host?.isConnected && pop.matches(':popover-open')) pop.hidePopover();
}