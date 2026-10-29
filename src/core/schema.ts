// Versioned settings schema, validation and migration. No DOM, no chrome.* here.

// v2: nothing is colored by default (no starter keywords, no fallback color).
// v3: Working Set statuses (`chats`), Presenter Mode, Recently Revisited switch. Additive: v2 data loads unchanged.
export const SCHEMA_VERSION = 3;

// ---- Provider-namespaced conversation keys -------------------------------------------------
// New per-conversation records are keyed `<provider>:<id>` so future adapters (ChatGPT, Claude)
// can share one store and a future sync can merge them without collisions. Only the ChatGPT
// adapter exists today. (Older `overrides` keys are bare ChatGPT ids; see docs/ARCHITECTURE.md.)
export const PROVIDERS = ['chatgpt', 'claude'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER: Provider = 'chatgpt';

export const chatKey = (id: string, provider: Provider = PROVIDER): string => `${provider}:${id}`;

export function parseChatKey(key: unknown): { provider: Provider; id: string } | null {
  if (typeof key !== 'string') return null;
  const i = key.indexOf(':');
  const provider = key.slice(0, i) as Provider;
  const id = normalizeId(key.slice(i + 1));
  return i > 0 && PROVIDERS.includes(provider) && id ? { provider, id } : null;
}

// ---- Working Set -----------------------------------------------------------------------------
export const STATUSES = ['active', 'hold', 'done'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status | 'none', string> = {
  active: 'Active',
  hold: 'On hold',
  done: 'Completed',
  none: 'Unassigned',
};

/**
 * Per-conversation metadata. `status: null` = Unassigned, kept (with its timestamp) rather than
 * deleted so a future sync can tell "cleared later" from "never set" (last-writer-wins by updatedAt).
 */
export interface ChatMeta {
  status: Status | null;
  updatedAt: number;
}

// ---- Presenter Mode ----------------------------------------------------------------------------
export const CONCEAL = ['blur', 'dots'] as const;
export type Conceal = (typeof CONCEAL)[number];
/** In-page shortcut while a ChatGPT tab is focused (no background worker, no extra permission). */
export const SHORTCUTS = ['Alt+Shift+P', 'Alt+Shift+H', 'Ctrl+Alt+P', 'off'] as const;
export type Shortcut = (typeof SHORTCUTS)[number];

/** Does a keyboard event match the configured shortcut exactly (no extra modifiers)? */
export function matchesShortcut(
  e: { altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string },
  sc: Shortcut,
): boolean {
  if (sc === 'off') return false;
  const parts = sc.split('+');
  const key = parts.pop()!;
  const want = { Alt: parts.includes('Alt'), Shift: parts.includes('Shift'), Ctrl: parts.includes('Ctrl') };
  return (
    e.code === `Key${key}` && e.altKey === want.Alt && e.shiftKey === want.Shift && e.ctrlKey === want.Ctrl && !e.metaKey
  );
}

export interface Presenter {
  enabled: boolean;
  /** blur = blurred titles, dots = titles rendered as dots. */
  style: Conceal;
  strength: number; // px, 2–12 (blur radius)
  /** Temporarily reveal a title on hover / keyboard focus. */
  reveal: boolean;
  shortcut: Shortcut;
}

/** Override value: a #rrggbb color, or NONE to force "no color" for that chat. */
export const NONE = 'none';
export type Override = string;

export interface KeywordRule {
  keyword: string;
  enabled: boolean;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  rules: KeywordRule[];
}

export const MODES = ['bar', 'fill', 'both'] as const;
export type Mode = (typeof MODES)[number];

export interface Appearance {
  /** bar = left edge only, fill = tinted row background, both. */
  mode: Mode;
  thickness: number; // px, 2–6
  opacity: number; // %, 10–100 (bar)
  radius: number; // px, 0–12 (bar)
  fill: number; // %, 5–40 (fill tint strength)
  /** Outline the conversation open in this tab (independent of its color). */
  highlight: boolean;
  /** Outline color: #rrggbb, or 'auto' = the sidebar's text color (adapts to light/dark). */
  outlineColor: string;
  outlineWidth: number; // px, 1–4
  outlineOpacity: number; // %, 20–100
}

export const AUTO = 'auto';

/** A color for every chat inside a Project or custom GPT. */
export interface GroupColor {
  color: string;
  /** Display only (last seen sidebar name or URL slug); the key is the stable id. */
  name: string;
}

export interface Settings {
  version: typeof SCHEMA_VERSION;
  enabled: boolean;
  /** Keyed by ChatGPT conversation UUID, never by title. */
  overrides: Record<string, Override>;
  /** Keyed by Project (`g-p-<hex>`) or custom GPT (`g-<id>`) id from the URL, never by name. */
  groups: Record<string, GroupColor>;
  /** Array order is rule priority. */
  categories: Category[];
  /** Color for chats with no override and no matching rule; NONE = no border. */
  fallback: Override;
  appearance: Appearance;
  /** Working Set statuses, keyed by chatKey(). */
  chats: Record<string, ChatMeta>;
  presenter: Presenter;
  /** Recently Revisited tracking (visit data itself is device-local, see core/visits.ts). */
  history: { enabled: boolean };
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Conversation ids seen so far are UUIDs; accept any URL-safe token so an id-format change doesn't break us. */
export const ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9_-]{7,127}';
const ID = new RegExp(`^${ID_PATTERN}$`);

/** Project (`g-p-<hex>`) or custom GPT (`g-<alnum>`) id, without the name slug that follows it in URLs. */
export const GROUP_PATTERN = 'g-p-[0-9a-f]{8,64}|g-[A-Za-z0-9]{6,64}';
const GROUP = new RegExp(`^(?:${GROUP_PATTERN})$`);
export const isGroupKey = (v: unknown): v is string => typeof v === 'string' && GROUP.test(v);

/** Canonical form of a conversation id (UUIDs lowercased, others kept as-is), or null if invalid. */
export function normalizeId(value: unknown): string | null {
  if (typeof value !== 'string' || !ID.test(value)) return null;
  return UUID.test(value) ? value.toLowerCase() : value;
}

/** Returns a lowercase #rrggbb or null. Accepts #rgb shorthand. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!HEX.test(v)) return null;
  const h = v.slice(1).toLowerCase();
  return '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h);
}

// Mid-saturation hues chosen for >= 3:1 contrast on both #ffffff and #212121 (see tests).
export const PALETTE = ['#16a34a', '#2f7de1', '#9b5de5', '#e8590c', '#e03131', '#0e9fb3', '#d6336c', '#b08900'];
export const NEUTRAL = '#8a8a8a';

/** Opt-in suggested keywords per starter category (also exactly what v1 shipped as defaults). */
export const STARTER_KEYWORDS: Record<string, string[]> = {
  work: ['meeting', 'client', 'report', 'email'],
  development: ['code', 'bug', 'typescript', 'python', 'api'],
  'ai-tools': ['prompt', 'gpt', 'llm', 'claude'],
  personal: ['recipe', 'travel', 'health'],
  urgent: ['urgent', 'asap'],
  research: ['research', 'paper', 'study'],
};

const cat = (id: string, name: string, color: string): Category => ({ id, name, color, enabled: true, rules: [] });

/** Starter categories are named colors for manual picking; nothing is auto-categorized until keywords are added. */
export function defaultSettings(): Settings {
  return {
    version: SCHEMA_VERSION,
    enabled: true,
    overrides: {},
    groups: {},
    categories: [
      cat('work', 'Work', '#16a34a'),
      cat('development', 'Development', '#2f7de1'),
      cat('ai-tools', 'AI Tools', '#9b5de5'),
      cat('personal', 'Personal', '#e8590c'),
      cat('urgent', 'Urgent', '#e03131'),
      cat('research', 'Research', '#0e9fb3'),
    ],
    fallback: NONE,
    // Bar only by default: subtle, no background tint (Fill is opt-in under Style).
    appearance: {
      mode: 'bar',
      thickness: 4,
      opacity: 100,
      radius: 6,
      fill: 16,
      highlight: true,
      outlineColor: AUTO,
      outlineWidth: 2,
      outlineOpacity: 65,
    },
    chats: {},
    presenter: { enabled: false, style: 'blur', strength: 6, reveal: true, shortcut: 'Alt+Shift+P' },
    history: { enabled: true },
  };
}

/** Set (or clear, with null) the Working Set status of several chats at once. */
export function setStatus(s: Settings, keys: string[], status: Status | null, now: number = Date.now()): void {
  for (const k of keys) if (parseChatKey(k)) s.chats[k] = { status, updatedAt: now };
}

export const statusOf = (s: Settings, key: string): Status | null => s.chats[key]?.status ?? null;

/** Adds the suggested keywords to matching starter categories (by id), skipping ones already present. */
export function addStarterKeywords(s: Settings): Settings {
  for (const c of s.categories) {
    for (const keyword of STARTER_KEYWORDS[c.id] ?? []) {
      if (!c.rules.some((r) => r.keyword.toLowerCase() === keyword)) c.rules.push({ keyword, enabled: true });
    }
  }
  return s;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clampInt = (v: unknown, min: number, max: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : dflt;
const normOverride = (v: unknown): Override | null => (v === NONE ? NONE : normalizeHex(v));

function normCategory(v: unknown, seen: Set<string>): Category | null {
  if (!isObj(v)) return null;
  const color = normalizeHex(v.color);
  const name = typeof v.name === 'string' ? v.name.trim().slice(0, 60) : '';
  let id = typeof v.id === 'string' && v.id ? v.id.slice(0, 60) : '';
  if (!color || !name) return null;
  if (!id || seen.has(id)) id = newId();
  seen.add(id);
  const rules = Array.isArray(v.rules)
    ? v.rules.flatMap((r): KeywordRule[] => {
        if (!isObj(r) || typeof r.keyword !== 'string' || !r.keyword.trim()) return [];
        return [{ keyword: r.keyword.trim().slice(0, 100), enabled: r.enabled !== false }];
      })
    : [];
  return { id, name, color, enabled: v.enabled !== false, rules };
}

/**
 * Coerce anything (stored data, imported JSON) into valid Settings.
 * Invalid fields fall back to defaults; invalid list entries are dropped.
 * Throws only for data from a newer schema version, which we must not downgrade silently.
 */
export function migrate(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > SCHEMA_VERSION) throw new Error(`Settings are from a newer version (v${version}).`);
  // v0 means "unversioned"; it is normalized below like v1.

  const overrides: Record<string, Override> = {};
  if (isObj(raw.overrides)) {
    for (const [k, v] of Object.entries(raw.overrides)) {
      const o = normOverride(v);
      const id = normalizeId(k);
      if (id && o) overrides[id] = o;
    }
  }
  // Additive field (no version bump): older data simply has none.
  const groups: Record<string, GroupColor> = {};
  if (isObj(raw.groups)) {
    for (const [k, v] of Object.entries(raw.groups)) {
      const color = isObj(v) ? normalizeHex(v.color) : null;
      if (!isGroupKey(k) || !color || !isObj(v)) continue;
      groups[k] = { color, name: typeof v.name === 'string' ? v.name.trim().slice(0, 80) : '' };
    }
  }
  const seen = new Set<string>();
  const categories = Array.isArray(raw.categories)
    ? raw.categories.flatMap((c) => normCategory(c, seen) ?? [])
    : d.categories;
  const a = isObj(raw.appearance) ? raw.appearance : {};
  let fallback = normOverride(raw.fallback) ?? d.fallback;
  if (version < 2) {
    // v1 shipped auto-coloring on by default. Remove exactly those defaults; anything the user
    // added or changed (custom keywords, a different fallback color) is kept.
    if (fallback === NEUTRAL) fallback = NONE;
    for (const c of categories) {
      const starter = STARTER_KEYWORDS[c.id];
      if (starter) c.rules = c.rules.filter((r) => !starter.includes(r.keyword));
    }
  }
  // v3 (additive): Working Set statuses, Presenter Mode, history switch.
  const chats: Record<string, ChatMeta> = {};
  if (isObj(raw.chats)) {
    for (const [k, v] of Object.entries(raw.chats)) {
      const key = parseChatKey(k);
      if (!key || !isObj(v)) continue;
      const status = STATUSES.includes(v.status as Status) ? (v.status as Status) : null;
      const updatedAt = typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) && v.updatedAt >= 0 ? v.updatedAt : 0;
      chats[chatKey(key.id, key.provider)] = { status, updatedAt };
    }
  }
  const p = isObj(raw.presenter) ? raw.presenter : {};
  const presenter: Presenter = {
    enabled: typeof p.enabled === 'boolean' ? p.enabled : d.presenter.enabled,
    style: CONCEAL.includes(p.style as Conceal) ? (p.style as Conceal) : d.presenter.style,
    strength: clampInt(p.strength, 2, 12, d.presenter.strength),
    reveal: typeof p.reveal === 'boolean' ? p.reveal : d.presenter.reveal,
    shortcut: SHORTCUTS.includes(p.shortcut as Shortcut) ? (p.shortcut as Shortcut) : d.presenter.shortcut,
  };
  const h = isObj(raw.history) ? raw.history : {};

  return {
    version: SCHEMA_VERSION,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    overrides,
    groups,
    categories,
    fallback,
    chats,
    presenter,
    history: { enabled: typeof h.enabled === 'boolean' ? h.enabled : d.history.enabled },
    appearance: {
      mode: MODES.includes(a.mode as Mode) ? (a.mode as Mode) : d.appearance.mode,
      thickness: clampInt(a.thickness, 2, 6, d.appearance.thickness),
      opacity: clampInt(a.opacity, 10, 100, d.appearance.opacity),
      radius: clampInt(a.radius, 0, 12, d.appearance.radius),
      fill: clampInt(a.fill, 5, 40, d.appearance.fill),
      highlight: typeof a.highlight === 'boolean' ? a.highlight : d.appearance.highlight,
      outlineColor: a.outlineColor === AUTO ? AUTO : (normalizeHex(a.outlineColor) ?? d.appearance.outlineColor),
      outlineWidth: clampInt(a.outlineWidth, 1, 4, d.appearance.outlineWidth),
      outlineOpacity: clampInt(a.outlineOpacity, 20, 100, d.appearance.outlineOpacity),
    },
  };
}

/** Strict parse for imports: rejects non-JSON and non-settings objects instead of silently resetting. */
export function parseImport(text: string): Settings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (!isObj(raw) || !('categories' in raw || 'overrides' in raw || 'groups' in raw || 'chats' in raw)) {
    throw new Error('File is not a Chat Colors export.');
  }
  return migrate(raw);
}

export function newId(): string {
  return crypto.randomUUID();
}
