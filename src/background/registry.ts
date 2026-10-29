// Pure logic for "already open in another tab". No chrome.* here (unit-tested directly).

/** tabId (as string key) -> conversation id open in that tab, or null when it is not on a conversation. */
export type OpenMap = Record<string, string | null>;

/** Conversation ids open in tabs OTHER than `tabId` (deduplicated). */
export function othersFor(m: OpenMap, tabId: number): string[] {
  const ids = new Set<string>();
  for (const [t, id] of Object.entries(m)) if (id && Number(t) !== tabId) ids.add(id);
  return [...ids];
}

/** Another tab showing `id`, excluding `exceptTab`; undefined if none. */
export function findOtherTab(m: OpenMap, id: string, exceptTab: number): number | undefined {
  const hit = Object.entries(m).find(([t, v]) => v === id && Number(t) !== exceptTab);
  return hit ? Number(hit[0]) : undefined;
}
