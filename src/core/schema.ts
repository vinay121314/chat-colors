// Versioned settings schema, validation and migration. No DOM, no chrome.* here.

// v2: nothing is colored by default (no starter keywords, no fallback color).
export const SCHEMA_VERSION = 2;

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
}

export interface Settings {
  version: typeof SCHEMA_VERSION;
  enabled: boolean;
  /** Keyed by ChatGPT conversation UUID, never by title. */
  overrides: Record<string, Override>;
  /** Array order is rule priority. */
  categories: Category[];
  /** Color for chats with no override and no matching rule; NONE = no border. */
  fallback: Override;
  appearance: Appearance;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Conversation ids seen so far are UUIDs; accept any URL-safe token so an id-format change doesn't break us. */
export const ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9_-]{7,127}';
const ID = new RegExp(`^${ID_PATTERN}$`);

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
    categories: [
      cat('work', 'Work', '#16a34a'),
      cat('development', 'Development', '#2f7de1'),
      cat('ai-tools', 'AI Tools', '#9b5de5'),
      cat('personal', 'Personal', '#e8590c'),
      cat('urgent', 'Urgent', '#e03131'),
      cat('research', 'Research', '#0e9fb3'),
    ],
    fallback: NONE,
    appearance: { mode: 'both', thickness: 4, opacity: 100, radius: 6, fill: 16 },
  };
}

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
  return {
    version: SCHEMA_VERSION,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    overrides,
    categories,
    fallback,
    appearance: {
      mode: MODES.includes(a.mode as Mode) ? (a.mode as Mode) : d.appearance.mode,
      thickness: clampInt(a.thickness, 2, 6, d.appearance.thickness),
      opacity: clampInt(a.opacity, 10, 100, d.appearance.opacity),
      radius: clampInt(a.radius, 0, 12, d.appearance.radius),
      fill: clampInt(a.fill, 5, 40, d.appearance.fill),
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
  if (!isObj(raw) || !('categories' in raw || 'overrides' in raw)) {
    throw new Error('File is not a ChatGPT Recents Colorizer export.');
  }
  return migrate(raw);
}

export function newId(): string {
  return crypto.randomUUID();
}
