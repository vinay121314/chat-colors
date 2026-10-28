// Minimal in-memory chrome.storage.local + onChanged, enough for storage.ts and multi-listener ("multi-tab") tests.
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type Listener = (changes: Changes, area: string) => void;

export const store: Record<string, unknown> = {};
const listeners: Listener[] = [];

export function resetChrome(): void {
  for (const k of Object.keys(store)) delete store[k];
  listeners.length = 0;
}

(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: { id: 'test', onMessage: { addListener() {} } },
  storage: {
    local: {
      async get(key: string) {
        return key in store ? { [key]: structuredClone(store[key]) } : {};
      },
      async set(items: Record<string, unknown>) {
        const changes: Changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: store[k], newValue: structuredClone(v) };
          store[k] = structuredClone(v);
        }
        for (const l of listeners) l(structuredClone(changes), 'local');
      },
      async remove(key: string) {
        const changes: Changes = { [key]: { oldValue: store[key] } };
        delete store[key];
        for (const l of listeners) l(structuredClone(changes), 'local');
      },
    },
    onChanged: { addListener: (l: Listener) => listeners.push(l) },
  },
};
