// Event-driven MV3 service worker for "already open in another tab".
//
// Privacy: it only ever handles tab ids and the conversation ids that our own content scripts send.
// It never reads tab URLs or titles (no `tabs` permission; never calls tabs.query or uses
// tabs.onUpdated), and it never sees conversation content.
// Suspension: all listeners are registered synchronously at top level and the only state lives in
// chrome.storage.session, so a restarted worker continues where it left off; the browser clears it
// on exit.
import { normalizeId } from '../core/schema';
import { MSG_FOCUS, MSG_OPEN, MSG_PRESENCE, OPEN_KEY } from '../core/storage';
import { findOtherTab, othersFor, type OpenMap } from './registry';

// Serialize read-modify-write cycles: concurrent tab messages must not lose each other's updates.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<OpenMap> {
  const v = (await chrome.storage.session.get(OPEN_KEY))[OPEN_KEY];
  return v && typeof v === 'object' ? (v as OpenMap) : {};
}

async function write(m: OpenMap): Promise<void> {
  await chrome.storage.session.set({ [OPEN_KEY]: m });
}

/** Tell every known tab which conversations are open elsewhere; prune tabs that no longer answer. */
async function broadcast(m: OpenMap, prune = true): Promise<void> {
  const dead: string[] = [];
  await Promise.all(
    Object.keys(m).map(async (t) => {
      try {
        await chrome.tabs.sendMessage(Number(t), { type: MSG_OPEN, ids: othersFor(m, Number(t)) });
      } catch {
        dead.push(t); // tab closed, navigated off ChatGPT, or extension reloaded there
      }
    }),
  );
  if (prune && dead.length) {
    for (const t of dead) delete m[t];
    await write(m);
    await broadcast(m, false);
  }
}

async function forget(tabId: number): Promise<void> {
  const m = await read();
  if (!(tabId in m)) return;
  delete m[tabId];
  await write(m);
  await broadcast(m);
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
  const tabId = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || tabId === undefined) return; // only our own content scripts
  const m = msg as { type?: string; id?: unknown } | null;

  if (m?.type === MSG_PRESENCE) {
    serial(async () => {
      const map = await read();
      map[tabId] = normalizeId(m.id);
      await write(map);
      await broadcast(map);
      return othersFor(map, tabId);
    }).then(reply, () => reply([]));
    return true; // async reply
  }

  if (m?.type === MSG_FOCUS) {
    serial(async () => {
      const id = normalizeId(m.id);
      const map = await read();
      const target = id ? findOtherTab(map, id, tabId) : undefined;
      if (target === undefined) return false;
      try {
        // Neither call needs the "tabs" permission: we only use ids, never URL/title fields.
        const tab = await chrome.tabs.update(target, { active: true });
        if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        return true;
      } catch {
        await forget(target); // tab vanished between report and click
        return false;
      }
    }).then(reply, () => reply(false));
    return true;
  }
  return undefined;
});

chrome.tabs.onRemoved.addListener((tabId) => void serial(() => forget(tabId)));
