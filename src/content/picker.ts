// In-page color picker. Lives in a shadow root (page CSS can't reach it) and uses the
// native popover API for light-dismiss and Esc handling.
import { resolveColor } from '../core/rules';
import { NONE, PALETTE, normalizeHex, type Settings } from '../core/schema';

export type SetOverride = (id: string, value: string | null) => void;

const CSS = `
:host { all: initial; }
[popover] {
  margin: 0; inset: auto; position: fixed; box-sizing: border-box; width: 232px;
  padding: 10px; border-radius: 10px; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
  color-scheme: light dark; background: Canvas; color: CanvasText;
  font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 8px 24px rgb(0 0 0 / .2);
}
p { margin: 0 0 6px; }
.title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.muted { opacity: .7; font-size: 12px; }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; margin: 8px 0; }
.sw { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; padding: 0; cursor: pointer; }
.sw[aria-pressed="true"] { border-color: CanvasText; }
.row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
input[type=text] { flex: 1; min-width: 0; font: inherit; padding: 3px 6px; border-radius: 6px; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
input[type=color] { width: 28px; height: 26px; padding: 0; border: 0; background: none; }
button.txt { font: inherit; padding: 4px 8px; border-radius: 6px; cursor: pointer; border: 1px solid color-mix(in srgb, CanvasText 25%, transparent); background: Canvas; color: CanvasText; }
button.txt:hover { background: color-mix(in srgb, CanvasText 8%, Canvas); }
:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
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

function button(label: string, onClick: () => void, cls = 'txt'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function openPicker(btn: HTMLElement, id: string, title: string, s: Settings, set: SetOverride): void {
  ensure();
  trigger = btn;
  const choose = (v: string | null) => {
    pop.hidePopover();
    set(id, v);
  };
  const cur = resolveColor(id, title, s);

  const t = document.createElement('p');
  t.className = 'title';
  t.textContent = title || 'Untitled conversation';
  const status = document.createElement('p');
  status.className = 'muted';
  status.textContent =
    cur.source === 'manual' ? 'Manual color' : cur.source === 'rule' ? `Auto: ${cur.category?.name}` : 'No rule matched';

  const grid = document.createElement('div');
  grid.className = 'grid';
  const seen = new Set<string>();
  const swatches: [string, string][] = [...s.categories.map((c): [string, string] => [c.color, c.name]), ...PALETTE.map((c): [string, string] => [c, c])];
  for (const [color, name] of swatches) {
    if (seen.has(color)) continue;
    seen.add(color);
    const b = button('', () => choose(color), 'sw');
    b.style.background = color;
    b.title = name;
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', String(cur.source === 'manual' && cur.color === color));
    grid.append(b);
  }

  const picker = document.createElement('input');
  picker.type = 'color';
  picker.value = cur.color ?? PALETTE[1]!;
  picker.setAttribute('aria-label', 'Custom color');
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.value = picker.value;
  hex.setAttribute('aria-label', 'Custom HEX color');
  hex.spellcheck = false;
  picker.addEventListener('input', () => {
    hex.value = picker.value;
    hex.setCustomValidity('');
  });
  const apply = () => {
    const v = normalizeHex(hex.value);
    if (!v) {
      hex.setCustomValidity('Use #rgb or #rrggbb');
      hex.reportValidity();
      return;
    }
    choose(v);
  };
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') apply();
  });
  const custom = document.createElement('div');
  custom.className = 'row';
  custom.append(picker, hex, button('Apply', apply));

  const actions = document.createElement('div');
  actions.className = 'row';
  actions.append(button('Reset to automatic', () => choose(null)), button('Remove color', () => choose(NONE)));

  pop.replaceChildren(t, status, grid, custom, actions);

  const r = btn.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 240))}px`;
  pop.style.top = `${Math.max(8, Math.min(r.bottom + 4, innerHeight - 220))}px`;
  if (!pop.matches(':popover-open')) pop.showPopover();
  btn.setAttribute('aria-expanded', 'true');
  grid.querySelector('button')?.focus();
}

export function closePicker(): void {
  if (host?.isConnected && pop.matches(':popover-open')) pop.hidePopover();
}
