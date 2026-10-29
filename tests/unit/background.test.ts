// Background worker (Feature 2) against a fake chrome API. The fake deliberately has NO tabs.query,
// tabs.onUpdated or tab url/title data: any attempt to use them fails the test.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findOtherTab, othersFor } from '../../src/background/registry';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

type Listener = (msg: unknown, sender: unknown, reply: (v: unknown) => void) => boolean | undefined;

function fakeChrome() {
  const session: Record<string, unknown> = {};
  const windows: Record<number, number> = { 1: 10, 2: 20, 3: 30 }; // tabId -> windowId
  const dead = new Set<number>();
  const f = {
    session,
    dead,
    onMessage: [] as Listener[],
    onRemoved: [] as ((tabId: number) => void)[],
    sent: [] as [number, unknown][],
    updated: [] as [number, unknown][],
    focused: [] as number[],
    chrome: {
      runtime: { id: 'ext', onMessage: { addListener: (l: Listener) => f.onMessage.push(l) } },
      storage: {
        session: {
          get: async (k: string) => (k in session ? { [k]: structuredClone(session[k]) } : {}),
          set: async (o: Record<string, unknown>) => void Object.assign(session, structuredClone(o)),
        },
      },
      tabs: {
        sendMessage: async (tabId: number, msg: unknown) => {
          if (dead.has(tabId)) throw new Error('Could not establish connection');
          f.sent.push([tabId, msg]);
          return true;
        },
        update: async (tabId: number, props: unknown) => {
          if (!(tabId in windows) || dead.has(tabId)) throw new Error('No tab with id');
          f.updated.push([tabId, props]);
          return { id: tabId, windowId: windows[tabId] }; // ids only, like without the "tabs" permission
        },
        onRemoved: { addListener: (l: (tabId: number) => void) => f.onRemoved.push(l) },
      },
      windows: { update: async (id: number) => void f.focused.push(id) },
    },
  };
  return f;
}

let f: ReturnType<typeof fakeChrome>;
const realChrome = (globalThis as { chrome?: unknown }).chrome;

/** (Re)start the worker: fresh module instance, same session storage (= suspension + wake-up). */
async function bootWorker() {
  f.onMessage.length = 0;
  f.onRemoved.length = 0;
  vi.resetModules();
  await import('../../src/background/main');
}

function send(msg: unknown, tabId?: number, senderId = 'ext'): Promise<unknown> {
  return new Promise((resolve) => {
    const r = f.onMessage[0]!(msg, { id: senderId, tab: tabId === undefined ? undefined : { id: tabId } }, resolve);
    if (r !== true) resolve(undefined);
  });
}
const presence = (tabId: number, id: string | null) => send({ type: 'crc:presence', id }, tabId);
const lastSentTo = (tabId: number) => [...f.sent].reverse().find(([t]) => t === tabId)?.[1];

beforeEach(async () => {
  f = fakeChrome();
  (globalThis as { chrome?: unknown }).chrome = f.chrome;
  await bootWorker();
});
afterEach(() => {
  (globalThis as { chrome?: unknown }).chrome = realChrome;
});

describe('registry (pure)', () => {
  it('othersFor excludes the asking tab and dedupes', () => {
    expect(othersFor({ 1: A, 2: B, 3: B, 4: null }, 1).sort()).toEqual([B]);
    expect(othersFor({ 1: A, 2: A }, 1)).toEqual([A]); // same chat in two tabs
  });
  it('findOtherTab never returns the asking tab', () => {
    expect(findOtherTab({ 1: A, 2: A }, A, 1)).toBe(2);
    expect(findOtherTab({ 1: A }, A, 1)).toBeUndefined();
  });
});

describe('background worker', () => {
  it('tracks which conversation each tab shows and tells every tab about the others', async () => {
    expect(await presence(1, A)).toEqual([]);
    expect(await presence(2, B)).toEqual([A]); // reply to the reporting tab
    expect(lastSentTo(1)).toEqual({ type: 'crc:open-elsewhere', ids: [B] }); // broadcast to the other
    expect(f.session['crc:open']).toEqual({ 1: A, 2: B }); // tab ids + conversation ids only
  });

  it('switches to the other tab and focuses its window, using ids only', async () => {
    await presence(1, A);
    await presence(3, B); // tab 3 lives in window 30
    expect(await send({ type: 'crc:focus', id: B }, 1)).toBe(true);
    expect(f.updated).toEqual([[3, { active: true }]]);
    expect(f.focused).toEqual([30]);
  });

  it('refuses to "switch" to the asking tab itself or to an unknown chat', async () => {
    await presence(1, A);
    expect(await send({ type: 'crc:focus', id: A }, 1)).toBe(false);
    expect(await send({ type: 'crc:focus', id: B }, 1)).toBe(false);
    expect(f.updated).toEqual([]);
  });

  it('tab closure removes the tab and updates the others', async () => {
    await presence(1, A);
    await presence(2, B);
    f.onRemoved[0]!(2);
    await vi.waitFor(() => expect(f.session['crc:open']).toEqual({ 1: A }));
    expect(lastSentTo(1)).toEqual({ type: 'crc:open-elsewhere', ids: [] });
  });

  it('navigation: a new conversation id replaces the old one; null (left the chat / page) clears it', async () => {
    await presence(1, A);
    await presence(2, B);
    await presence(2, A);
    expect(lastSentTo(1)).toEqual({ type: 'crc:open-elsewhere', ids: [A] });
    await presence(2, null);
    expect(lastSentTo(1)).toEqual({ type: 'crc:open-elsewhere', ids: [] });
  });

  it('prunes tabs that no longer answer (navigated away / extension reloaded there)', async () => {
    await presence(1, A);
    await presence(2, B);
    f.dead.add(2);
    await presence(1, A);
    expect(f.session['crc:open']).toEqual({ 1: A });
  });

  it('a vanished target tab is forgotten instead of failing loudly', async () => {
    await presence(1, A);
    await presence(2, B);
    f.dead.add(2);
    expect(await send({ type: 'crc:focus', id: B }, 1)).toBe(false);
    expect(f.session['crc:open']).toEqual({ 1: A });
  });

  it('survives service-worker suspension: state lives in storage.session', async () => {
    await presence(1, A);
    await presence(2, B);
    await bootWorker(); // worker killed and restarted
    expect(await send({ type: 'crc:focus', id: B }, 1)).toBe(true);
    expect(f.updated).toEqual([[2, { active: true }]]);
  });

  it('ignores messages from other extensions or without a tab, and invalid ids', async () => {
    await send({ type: 'crc:presence', id: A }, 1, 'someone-else');
    await send({ type: 'crc:presence', id: A }); // no sender tab (e.g. the popup)
    expect(f.session['crc:open']).toBeUndefined();
    await presence(1, 'not a valid id!');
    expect(f.session['crc:open']).toEqual({ 1: null });
  });

  it('serializes concurrent reports (no lost updates)', async () => {
    await Promise.all([presence(1, A), presence(2, B), presence(3, A)]);
    expect(f.session['crc:open']).toEqual({ 1: A, 2: B, 3: A });
  });
});
