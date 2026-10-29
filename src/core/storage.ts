import { migrate, type Settings } from './schema';

export const KEY = 'crc:settings';
/** Popup -> content script: "which conversation is open in this tab?" */
export const MSG_CURRENT = 'crc:current';
/** Popup -> content script: structural diagnostics (no titles, ids masked). */
export const MSG_DIAG = 'crc:diag';
/** Content -> worker: "this tab now shows conversation <id | null>". Reply: ids open in other tabs. */
export const MSG_PRESENCE = 'crc:presence';
/** Content -> worker: "switch to the other tab showing <id>". Reply: boolean. */
export const MSG_FOCUS = 'crc:focus';
/** Worker -> content: conversation ids currently open in other tabs. */
export const MSG_OPEN = 'crc:open-elsewhere';
/** chrome.storage.session key for the worker's tabId -> conversation id map (cleared on browser exit). */
export const OPEN_KEY = 'crc:open';

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
 * Sidebar filter: a #rrggbb color (show only chats with that color) or null. Stored apart from
 * settings so it is never exported and a reset doesn't touch it.
 */
export const FILTER_KEY = 'crc:filter';

export async function loadFilter(): Promise<string | null> {
  const v = (await chrome.storage.local.get(FILTER_KEY))[FILTER_KEY];
  return typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

export async function saveFilter(v: string | null): Promise<void> {
  await (v ? chrome.storage.local.set({ [FILTER_KEY]: v }) : chrome.storage.local.remove(FILTER_KEY));
}

export function onFilter(cb: (v: string | null) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(FILTER_KEY in changes)) return;
    const v = changes[FILTER_KEY]?.newValue;
    cb(typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v) ? v : null);
  });
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
