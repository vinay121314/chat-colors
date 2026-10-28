// Content-script entry: wires the colorizer to chrome.storage and the popup.
import { load, loadFilter, MSG_CURRENT, MSG_DIAG, onChange, onFilter, saveFilter, update } from '../core/storage';
import { diagnose } from './adapter';
import { createColorizer } from './colorizer';

// Extension was reloaded/removed: this script is orphaned. Clean up and go quiet.
const orphaned = () => {
  if (!chrome.runtime?.id) colorizer.stop();
};

const colorizer = createColorizer({
  write: (fn) => void update(fn).catch(orphaned),
  setFilter: (v) => void saveFilter(v).catch(orphaned),
});

void Promise.all([load(), loadFilter()]).then(([s, f]) => {
  colorizer.setFilter(f);
  colorizer.update(s);
});
onChange((s) => colorizer.update(s));
onFilter((f) => colorizer.setFilter(f));

chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
  const type = (msg as { type?: string } | null)?.type;
  if (type === MSG_CURRENT) reply(colorizer.current());
  else if (type === MSG_DIAG) reply({ version: chrome.runtime.getManifest().version, ...diagnose() });
});
