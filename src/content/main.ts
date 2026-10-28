// Content-script entry: wires the colorizer to chrome.storage and the popup.
import { load, MSG_CURRENT, MSG_DIAG, onChange, update } from '../core/storage';
import { diagnose } from './adapter';
import { createColorizer } from './colorizer';

const colorizer = createColorizer((id, value) => {
  update((s) => {
    if (value === null) delete s.overrides[id];
    else s.overrides[id] = value;
  }).catch(() => {
    // Extension was reloaded/removed: this script is orphaned. Clean up and go quiet.
    if (!chrome.runtime?.id) colorizer.stop();
  });
});

void load().then((s) => colorizer.update(s));
onChange((s) => colorizer.update(s));

chrome.runtime.onMessage.addListener((msg: unknown, _sender, reply) => {
  const type = (msg as { type?: string } | null)?.type;
  if (type === MSG_CURRENT) reply(colorizer.current());
  else if (type === MSG_DIAG) reply({ version: chrome.runtime.getManifest().version, ...diagnose() });
});
