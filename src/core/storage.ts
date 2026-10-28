import { migrate, type Settings } from './schema';

export const KEY = 'crc:settings';
/** Popup -> content script: "which conversation is open in this tab?" */
export const MSG_CURRENT = 'crc:current';
/** Popup -> content script: structural diagnostics (no titles, ids masked). */
export const MSG_DIAG = 'crc:diag';

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
