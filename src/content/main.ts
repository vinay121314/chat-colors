// Content-script entry: wires the colorizer to chrome.storage, the popup and the background worker.
import type { Settings } from '../core/schema';
import {
  MSG_CURRENT,
  MSG_DIAG,
  MSG_FOCUS,
  MSG_OPEN,
  MSG_PRESENCE,
  load,
  loadFilter,
  onChange,
  onFilter,
  saveFilter,
  update,
} from '../core/storage';
import { diagnose, parseConversationId } from './adapter';
import { createColorizer } from './colorizer';

// Extension was reloaded/removed: this script is orphaned. Clean up and go quiet.
const orphaned = () => {
  if (!chrome.runtime?.id) colorizer.stop();
};

let settings: Settings | null = null;

// ---- "Open in another tab": report only this tab's conversation id (or null) to our worker.
let reported: string | null | undefined;
function reportPresence(force = false): void {
  const share = !!settings?.enabled && settings.appearance.openTabs;
  const id = share ? parseConversationId(location.pathname) : null;
  if (id === reported && !force) return;
  reported = id;
  chrome.runtime
    .sendMessage({ type: MSG_PRESENCE, id })
    .then((ids: unknown) => Array.isArray(ids) && share && colorizer.setElsewhere(ids as string[]))
    .catch(orphaned);
}

const colorizer = createColorizer({
  write: (fn) => void update(fn).catch(orphaned),
  setFilter: (v) => void saveFilter(v).catch(orphaned),
  focusTab: (id) => void chrome.runtime.sendMessage({ type: MSG_FOCUS, id }).catch(orphaned),
  scanned: () => reportPresence(),
});

function apply(s: Settings): void {
  settings = s;
  colorizer.update(s);
  reportPresence(); // also covers disabling / turning the feature off (reports null)
  if (!s.enabled || !s.appearance.openTabs) colorizer.setElsewhere([]);
}

void Promise.all([load(), loadFilter()]).then(([s, f]) => {
  colorizer.setFilter(f);
  apply(s);
});
onChange(apply);
onFilter((f) => colorizer.setFilter(f));

// Leaving the page (navigation away, reload, close): tell the worker this tab no longer shows a chat.
addEventListener('pagehide', () => {
  reported = undefined;
  chrome.runtime.sendMessage({ type: MSG_PRESENCE, id: null }).catch(() => undefined);
});
// Restored from the back/forward cache: report again.
addEventListener('pageshow', (e) => {
  if (e.persisted) reportPresence(true);
});

chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
  const m = msg as { type?: string; ids?: unknown } | null;
  if (m?.type === MSG_CURRENT) reply(colorizer.current());
  else if (m?.type === MSG_DIAG) reply({ version: chrome.runtime.getManifest().version, ...diagnose() });
  else if (m?.type === MSG_OPEN && Array.isArray(m.ids)) {
    if (settings?.enabled && settings.appearance.openTabs) colorizer.setElsewhere(m.ids as string[]);
    reply(true); // lets the worker know this tab is alive
  }
});
