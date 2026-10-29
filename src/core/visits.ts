// Recently Revisited: local visit history. Pure functions; no DOM, no chrome.*.
//
// Stores ONLY conversation keys (chatKey(): `<provider>:<id>`) and timestamps/counts. No titles,
// no message content. Device-local by design (a "where was I" signal for this browser); it is
// not part of the exported/synced settings. Bounded: at most VISIT_CAP entries, none older than
// VISIT_MAX_AGE_MS.

export interface Visit {
  first: number;
  last: number;
  count: number;
}
export type Visits = Record<string, Visit>;

export const VISIT_CAP = 500;
export const VISIT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Drop invalid, expired and excess (oldest-first) entries. */
export function normalizeVisits(raw: unknown, now: number = Date.now()): Visits {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const ok = Object.entries(raw as Record<string, unknown>).flatMap(([k, v]): [string, Visit][] => {
    const o = v as Partial<Visit> | null;
    if (!o || typeof o !== 'object' || !/^[a-z]+:[A-Za-z0-9_-]{8,128}$/.test(k)) return [];
    const { first, last, count } = o;
    if (![first, last, count].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return [];
    if (now - last! > VISIT_MAX_AGE_MS) return [];
    return [[k, { first: first!, last: last!, count: Math.max(1, Math.floor(count!)) }]];
  });
  ok.sort((a, b) => b[1].last - a[1].last);
  return Object.fromEntries(ok.slice(0, VISIT_CAP));
}

/** Record that `key` was opened at `now`. Returns a new, bounded map. */
export function recordVisit(v: Visits, key: string, now: number = Date.now()): Visits {
  const prev = v[key];
  const next = { ...v, [key]: prev ? { first: prev.first, last: now, count: prev.count + 1 } : { first: now, last: now, count: 1 } };
  return normalizeVisits(next, now);
}

/** Conversations opened more than once, most recently revisited first. */
export function revisited(v: Visits): [string, Visit][] {
  return Object.entries(v)
    .filter(([, x]) => x.count >= 2)
    .sort((a, b) => b[1].last - a[1].last);
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function ago(ts: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
