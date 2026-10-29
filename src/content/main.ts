// Content-script entry: wires the colorizer to chrome.storage and the popup.
import { MSG_CURRENT, MSG_DIAG, MSG_LIST, load, loadFilter, onChange, onFilter, saveFilter } from '../core/storage';
import { diagnose } from './adapter';
import { createColorizer } from './colorizer';

const colorizer = createColorizer({
  setFilter: (v) =>
    void saveFilter(v).catch(() => {
      // Extension was reloaded/removed: this script is orphaned. Clean up and go quiet.
      if (!chrome.runtime?.id) colorizer.stop();
    }),
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
  else if (type === MSG_LIST) reply(colorizer.list());
  else if (type === MSG_DIAG) reply({ version: chrome.runtime.getManifest().version, ...diagnose() });
});
