import { describe, expect, it } from 'vitest';
import { NONE, SCHEMA_VERSION, defaultSettings, migrate, normalizeHex, parseImport } from '../../src/core/schema';

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

  it('refuses data from a newer schema version', () => {
    expect(() => migrate({ version: SCHEMA_VERSION + 1 })).toThrow(/newer version/);
  });

  it('drops invalid overrides (bad id, bad color) and keeps NONE', () => {
    const s = migrate({
      overrides: { [ID]: 'none', 'not-a-uuid': '#ff0000', [ID.replace('1', '2')]: 'blue', [ID.toUpperCase().replace('1', '3')]: '#ABC' },
    });
    expect(s.overrides).toEqual({ [ID]: NONE, [ID.replace('1', '3')]: '#aabbcc' });
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

  it('keeps an explicitly empty category list (user deleted all)', () => {
    expect(migrate({ categories: [] }).categories).toEqual([]);
  });

  it('clamps appearance values', () => {
    const s = migrate({ appearance: { thickness: 99, opacity: -5, radius: 'x' } });
    expect(s.appearance).toEqual({ thickness: 6, opacity: 10, radius: defaultSettings().appearance.radius });
  });

  it('is idempotent', () => {
    const once = migrate({ overrides: { [ID]: '#abc' }, appearance: { thickness: 3 } });
    expect(migrate(structuredClone(once))).toEqual(once);
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
    expect(() => parseImport('{"hello":1}')).toThrow(/not a ChatGPT Recents Colorizer export/);
    expect(() => parseImport('[1,2]')).toThrow();
  });
  it('rejects exports from a newer version', () => {
    expect(() => parseImport(JSON.stringify({ version: 99, categories: [] }))).toThrow(/newer/);
  });
});
