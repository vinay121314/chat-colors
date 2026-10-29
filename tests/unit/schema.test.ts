import { describe, expect, it } from 'vitest';
import {
  NONE,
  SCHEMA_VERSION,
  chatKey,
  defaultSettings,
  matchesShortcut,
  migrate,
  normalizeHex,
  parseChatKey,
  parseImport,
  setStatus,
  statusOf,
} from '../../src/core/schema';

const ID = '11111111-1111-4111-8111-111111111111';

describe('normalizeHex', () => {
  it('accepts #rgb and #rrggbb, lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex(' #12Ab9F ')).toBe('#12ab9f');
  });
  it.each(['', 'red', '#12', '#1234', '#12345g', '123456', 'rgb(1,2,3)', '#1234567', null, 5, {}])(
    'rejects %p',
    (v) => expect(normalizeHex(v)).toBeNull(),
  );
});

describe('migrate', () => {
  it('returns defaults for missing or garbage data', () => {
    for (const raw of [undefined, null, 'x', 42, [], true]) expect(migrate(raw)).toEqual(defaultSettings());
  });

  it('upgrades unversioned (v0) data to the current version', () => {
    const s = migrate({ enabled: false, overrides: { [ID]: '#ff0000' } });
    expect(s.version).toBe(SCHEMA_VERSION);
    expect(s.enabled).toBe(false);
    expect(s.overrides[ID]).toBe('#ff0000');
  });

  it('v1 -> v2 removes only the old auto-coloring defaults, keeping user changes', () => {
    const v1 = {
      version: 1,
      fallback: '#8a8a8a', // old default
      overrides: { [ID]: '#ff0000' },
      categories: [
        { id: 'work', name: 'Work', color: '#16a34a', rules: ['meeting', 'client', 'report', 'email', 'standup'].map((keyword) => ({ keyword })) },
        { id: 'urgent', name: 'Urgent', color: '#e03131', rules: [{ keyword: 'urgent' }, { keyword: 'asap' }] },
        { id: 'mine', name: 'Mine', color: '#123456', rules: [{ keyword: 'client' }] },
      ],
    };
    const s = migrate(v1);
    expect(s.version).toBe(SCHEMA_VERSION); // migrates through v2 to the current version
    expect(s.fallback).toBe(NONE);
    expect(s.overrides[ID]).toBe('#ff0000');
    expect(s.categories.map((c) => c.rules.map((r) => r.keyword))).toEqual([['standup'], [], ['client']]);
    // A customised v1 fallback is kept.
    expect(migrate({ version: 1, fallback: '#abcdef' }).fallback).toBe('#abcdef');
    // v2 data is not touched by the v1 cleanup.
    expect(migrate({ version: 2, fallback: '#8a8a8a', categories: v1.categories }).categories[1]!.rules).toHaveLength(2);
  });

  it('refuses data from a newer schema version', () => {
    expect(() => migrate({ version: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
  });

  it('drops invalid overrides (bad id, bad color) and keeps NONE', () => {
    const s = migrate({
      overrides: {
        [ID]: 'none',
        'bad id!': '#ff0000',
        short: '#ff0000',
        [ID.replace('1', '2')]: 'blue',
        [ID.toUpperCase().replace('1', '3')]: '#ABC',
        'Tok_en-12345': '#000',
      },
    });
    expect(s.overrides).toEqual({ [ID]: NONE, [ID.replace('1', '3')]: '#aabbcc', 'Tok_en-12345': '#000000' });
  });

  it('drops invalid categories and rules, dedupes ids, keeps order', () => {
    const s = migrate({
      categories: [
        { id: 'a', name: 'A', color: '#111', rules: [{ keyword: ' x ' }, { keyword: '' }, 'junk', { keyword: 'y', enabled: false }] },
        { id: 'a', name: 'Dup id', color: '#222222' },
        { id: 'b', name: '', color: '#333333' },
        { id: 'c', name: 'Bad color', color: 'nope' },
        null,
      ],
    });
    expect(s.categories.map((c) => c.name)).toEqual(['A', 'Dup id']);
    expect(s.categories[0]!.rules).toEqual([
      { keyword: 'x', enabled: true },
      { keyword: 'y', enabled: false },
    ]);
    expect(s.categories[1]!.id).not.toBe('a');
  });

  it('validates Project/GPT colors (key format, color), keeping names for display', () => {
    const s = migrate({
      groups: {
        'g-p-0123456789abcdef': { color: '#ABC', name: '  Side project ' },
        'g-AbCdEf123': { color: '#123456' },
        'not-a-group': { color: '#123456', name: 'x' },
        'g-p-zzzz': { color: '#123456' },
        'g-AbCdEf999': { color: 'red' },
      },
    });
    expect(s.groups).toEqual({
      'g-p-0123456789abcdef': { color: '#aabbcc', name: 'Side project' },
      'g-AbCdEf123': { color: '#123456', name: '' },
    });
  });

  it('keeps an explicitly empty category list (user deleted all)', () => {
    expect(migrate({ categories: [] }).categories).toEqual([]);
  });

  it('clamps appearance values', () => {
    const d = defaultSettings().appearance;
    const s = migrate({ appearance: { thickness: 99, opacity: -5, radius: 'x', mode: 'neon', fill: 90 } });
    expect(s.appearance).toEqual({
      mode: d.mode,
      thickness: 6,
      opacity: 10,
      radius: d.radius,
      fill: 40,
      highlight: true,
      outlineColor: 'auto',
      outlineWidth: 2,
      outlineOpacity: 65,
    });
    // Outline: HEX normalized, 'auto' kept, junk -> default; width/opacity clamped.
    const o = migrate({ appearance: { outlineColor: '#ABC', outlineWidth: 9, outlineOpacity: 1 } }).appearance;
    expect([o.outlineColor, o.outlineWidth, o.outlineOpacity]).toEqual(['#aabbcc', 4, 20]);
    expect(migrate({ appearance: { outlineColor: 'red' } }).appearance.outlineColor).toBe('auto');
    // Removed setting from an older build is dropped, not carried along.
    expect(migrate({ appearance: { openTabs: true } }).appearance).not.toHaveProperty('openTabs');
    expect(migrate({ appearance: { highlight: false } }).appearance.highlight).toBe(false);
    expect(migrate({ appearance: { highlight: 'yes' } }).appearance.highlight).toBe(true); // invalid -> default
    expect(migrate({ appearance: { mode: 'fill' } }).appearance.mode).toBe('fill');
    // Settings saved before fill existed get the new defaults (bar + fill).
    expect(migrate({ version: 1, appearance: { thickness: 3, opacity: 80, radius: 2 } }).appearance).toMatchObject({ mode: 'bar', fill: 16, thickness: 3 }); // bar by default; an explicit saved mode is kept
    expect(migrate({ appearance: { mode: 'both' } }).appearance.mode).toBe('both');
  });

  it('is idempotent', () => {
    const once = migrate({ overrides: { [ID]: '#abc' }, appearance: { thickness: 3 } });
    expect(migrate(structuredClone(once))).toEqual(once);
  });
});

describe('v3: Working Set, Presenter, history, provider keys', () => {
  it('v2 data loads unchanged with v3 defaults added', () => {
    const v2 = { version: 2, overrides: { [ID]: '#123456' }, appearance: { mode: 'both' } };
    const s = migrate(v2);
    expect(s.version).toBe(3);
    expect(s.overrides[ID]).toBe('#123456');
    expect(s.appearance.mode).toBe('both');
    expect(s.chats).toEqual({});
    expect(s.presenter).toEqual({ enabled: false, style: 'blur', strength: 6, reveal: true, shortcut: 'Alt+Shift+P' });
    expect(s.history).toEqual({ enabled: true });
  });

  it('chat keys are provider-namespaced; parseChatKey validates provider and id', () => {
    expect(chatKey(ID)).toBe(`chatgpt:${ID}`);
    expect(chatKey(ID, 'claude')).toBe(`claude:${ID}`);
    expect(parseChatKey(`chatgpt:${ID.toUpperCase()}`)).toEqual({ provider: 'chatgpt', id: ID });
    for (const bad of [ID, `bard:${ID}`, 'chatgpt:short', `:${ID}`, 42]) expect(parseChatKey(bad)).toBeNull();
  });

  it('statuses carry updatedAt; Unassigned is a timestamped null (sync-friendly); junk dropped', () => {
    const s = defaultSettings();
    setStatus(s, [chatKey(ID), 'not-a-key'], 'active', 1000);
    expect(s.chats).toEqual({ [chatKey(ID)]: { status: 'active', updatedAt: 1000 } });
    setStatus(s, [chatKey(ID)], null, 2000);
    expect(s.chats[chatKey(ID)]).toEqual({ status: null, updatedAt: 2000 });
    expect(statusOf(s, chatKey(ID))).toBeNull();

    const m = migrate({
      chats: {
        [`chatgpt:${ID}`]: { status: 'hold', updatedAt: 5 },
        [`claude:${ID}`]: { status: 'done', updatedAt: 6 }, // future adapter data is preserved
        [`chatgpt:${ID.replace('1', '2')}`]: { status: 'weird', updatedAt: -1 },
        nonsense: { status: 'active', updatedAt: 1 },
      },
    });
    expect(m.chats).toEqual({
      [`chatgpt:${ID}`]: { status: 'hold', updatedAt: 5 },
      [`claude:${ID}`]: { status: 'done', updatedAt: 6 },
      [`chatgpt:${ID.replace('1', '2')}`]: { status: null, updatedAt: 0 },
    });
  });

  it('presenter settings are validated and clamped', () => {
    const p = migrate({ presenter: { enabled: true, style: 'dots', strength: 99, reveal: false, shortcut: 'Ctrl+Alt+P' } }).presenter;
    expect(p).toEqual({ enabled: true, style: 'dots', strength: 12, reveal: false, shortcut: 'Ctrl+Alt+P' });
    const bad = migrate({ presenter: { enabled: 'yes', style: 'x', strength: 'big', shortcut: 'F12' } }).presenter;
    expect(bad).toEqual(defaultSettings().presenter);
  });

  it('matchesShortcut requires the exact modifiers', () => {
    const ev = (o: Partial<{ altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; code: string }>) => ({
      altKey: false,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      code: 'KeyP',
      ...o,
    });
    expect(matchesShortcut(ev({ altKey: true, shiftKey: true }), 'Alt+Shift+P')).toBe(true);
    expect(matchesShortcut(ev({ altKey: true, shiftKey: true, ctrlKey: true }), 'Alt+Shift+P')).toBe(false);
    expect(matchesShortcut(ev({ altKey: true }), 'Alt+Shift+P')).toBe(false);
    expect(matchesShortcut(ev({ ctrlKey: true, altKey: true }), 'Ctrl+Alt+P')).toBe(true);
    expect(matchesShortcut(ev({ altKey: true, shiftKey: true, code: 'KeyH' }), 'Alt+Shift+H')).toBe(true);
    expect(matchesShortcut(ev({ altKey: true, shiftKey: true }), 'off')).toBe(false);
  });

  it('export/import round-trips statuses and presenter settings', () => {
    const s = defaultSettings();
    setStatus(s, [chatKey(ID)], 'done', 42);
    s.presenter.enabled = true;
    expect(parseImport(JSON.stringify(s))).toEqual(s);
  });
});

describe('parseImport / export round trip', () => {
  it('round-trips exported settings', () => {
    const s = defaultSettings();
    s.overrides[ID] = '#123456';
    s.categories.reverse();
    expect(parseImport(JSON.stringify(s))).toEqual(s);
  });
  it('rejects non-JSON', () => expect(() => parseImport('{oops')).toThrow(/not valid JSON/));
  it('rejects unrelated JSON instead of silently resetting', () => {
    expect(() => parseImport('{"hello":1}')).toThrow(/not a Chat Colors export/);
    expect(() => parseImport('[1,2]')).toThrow();
  });
  it('rejects exports from a newer version', () => {
    expect(() => parseImport(JSON.stringify({ version: 99, categories: [] }))).toThrow(/newer/);
  });
});
