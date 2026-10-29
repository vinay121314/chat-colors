// Content-script entry: wires the colorizer to chrome.storage and the popup.
import { chatKey, matchesShortcut, type Settings } from '../core/schema';
import {
  MSG_CURRENT,
  MSG_DIAG,
  MSG_LIST,
  load,
  loadFilter,
  onChange,
  onFilter,
  recordVisitFor,
  saveFilter,
  update,
} from '../core/storage';
import { diagnose } from './adapter';
import { createColorizer } from './colorizer';

let settings: Settings | null = null;

// Extension was reloaded/removed: this script is orphaned. Clean up and go quiet.
const orphaned = () => {
  if (!chrome.runtime?.id) colorizer.stop();
};

const colorizer = createColorizer({
  setFilter: (v) => void saveFilter(v).catch(orphaned),
  // Recently Revisited: conversation key + timestamp only, and only while history is on.
  opened: (id) => {
    if (settings?.history.enabled) void recordVisitFor(chatKey(id)).catch(orphaned);
  },
});

function apply(s: Settings): void {
  settings = s;
  colorizer.update(s);
}

void Promise.all([load(), loadFilter()]).then(([s, f]) => {
  colorizer.setFilter(f);
  apply(s);
});
onChange(apply);
onFilter((f) => colorizer.setFilter(f));

// Presenter Mode shortcut (in-page; works while a ChatGPT tab has focus). Only the exact configured
// combination is consumed; every other key reaches ChatGPT untouched.
addEventListener(
  'keydown',
  (e) => {
    if (!settings?.enabled || e.repeat || !matchesShortcut(e, settings.presenter.shortcut)) return;
    e.preventDefault();
    e.stopPropagation();
    void update((x) => (x.presenter.enabled = !x.presenter.enabled)).catch(orphaned);
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
  const type = (msg as { type?: string } | null)?.type;
  if (type === MSG_CURRENT) reply(colorizer.current());
  else if (type === MSG_LIST) reply(colorizer.list());
  else if (type === MSG_DIAG) reply({ version: chrome.runtime.getManifest().version, ...diagnose() });
});
