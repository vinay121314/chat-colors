import { STATUSES, migrate, type Settings } from './schema';
import { normalizeVisits, recordVisit, type Visits } from './visits';

export const KEY = 'crc:settings';
/** Popup -> content script: "which conversation is open in this tab?" */
export const MSG_CURRENT = 'crc:current';
/** Popup -> content script: structural diagnostics (no titles, ids masked). */
export const MSG_DIAG = 'crc:diag';
/** Popup -> content script: the conversations loaded in the sidebar (id, visible title, color). Not stored. */
export const MSG_LIST = 'crc:list';

/** Loads settings; malformed or missing data is repaired to valid defaults. */
export async function load(): Promise<Settings> {
  const got = await chrome.storage.local.get(KEY);
  try {
    return migrate(got[KEY]);
  } catch {
    // Newer-version data: run on defaults but never overwrite it (no save here).
    return migrate(undefined);
  }
}

export async function save(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}

/** Read-modify-write against the latest stored value, so popup and tabs don't clobber each other. */
export async function update(fn: (s: Settings) => void): Promise<Settings> {
  const s = await load();
  fn(s);
  await save(s);
  return s;
}

/**
 * Sidebar filter: a #rrggbb color, or `status:<active|hold|done|none>` (Working Set), or null.
 * Stored apart from settings so it is never exported and a reset doesn't touch it.
 */
export const FILTER_KEY = 'crc:filter';
const FILTER_RE = new RegExp(`^(#[0-9a-f]{6}|status:(${STATUSES.join('|')}|none))$`);
export const validFilter = (v: unknown): string | null => (typeof v === 'string' && FILTER_RE.test(v) ? v : null);

export async function loadFilter(): Promise<string | null> {
  return validFilter((await chrome.storage.local.get(FILTER_KEY))[FILTER_KEY]);
}

export async function saveFilter(v: string | null): Promise<void> {
  await (v ? chrome.storage.local.set({ [FILTER_KEY]: v }) : chrome.storage.local.remove(FILTER_KEY));
}

export function onFilter(cb: (v: string | null) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(FILTER_KEY in changes)) return;
    cb(validFilter(changes[FILTER_KEY]?.newValue));
  });
}

/** Recently Revisited: device-local visit history (ids + timestamps only; never exported). */
export const VISITS_KEY = 'crc:visits';

export async function loadVisits(): Promise<Visits> {
  return normalizeVisits((await chrome.storage.local.get(VISITS_KEY))[VISITS_KEY]);
}

export async function recordVisitFor(key: string, now: number = Date.now()): Promise<void> {
  await chrome.storage.local.set({ [VISITS_KEY]: recordVisit(await loadVisits(), key, now) });
}

export async function clearVisits(): Promise<void> {
  await chrome.storage.local.remove(VISITS_KEY);
}

export function onChange(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(KEY in changes)) return;
    try {
      cb(migrate(changes[KEY]?.newValue));
    } catch {
      /* newer-version data written elsewhere; ignore */
    }
  });
}
