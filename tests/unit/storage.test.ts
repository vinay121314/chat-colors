import { describe, expect, it, vi } from 'vitest';
import { defaultSettings } from '../../src/core/schema';
import {
  KEY,
  VISITS_KEY,
  clearVisits,
  load,
  loadVisits,
  onChange,
  recordVisitFor,
  save,
  update,
  validFilter,
} from '../../src/core/storage';
import { store } from './chrome-mock';

const ID = '11111111-1111-4111-8111-111111111111';

describe('storage', () => {
  it('loads defaults when empty, and repairs malformed data', async () => {
    expect(await load()).toEqual(defaultSettings());
    store[KEY] = { version: 1, overrides: 'garbage', appearance: { thickness: 'x' } };
    const s = await load();
    expect(s.overrides).toEqual({});
    expect(s.appearance.thickness).toBe(4);
  });

  it('persists and reloads (survives "restart")', async () => {
    const s = defaultSettings();
    s.overrides[ID] = '#abcdef';
    await save(s);
    expect(await load()).toEqual(s);
  });

  it('update() applies to the latest stored value', async () => {
    await update((s) => (s.overrides[ID] = '#111111'));
    await update((s) => (s.appearance.thickness = 2));
    const s = await load();
    expect(s.overrides[ID]).toBe('#111111');
    expect(s.appearance.thickness).toBe(2);
  });

  it('does not overwrite newer-version data on load', async () => {
    store[KEY] = { version: 99, secret: 'future' };
    expect(await load()).toEqual(defaultSettings());
    expect(store[KEY]).toEqual({ version: 99, secret: 'future' });
  });

  it('notifies every listener (multiple ChatGPT tabs) with validated settings', async () => {
    const tabA = vi.fn();
    const tabB = vi.fn();
    onChange(tabA);
    onChange(tabB);
    await update((s) => (s.overrides[ID] = '#222222'));
    for (const t of [tabA, tabB]) {
      expect(t).toHaveBeenCalledOnce();
      expect(t.mock.calls[0]![0].overrides[ID]).toBe('#222222');
    }
  });
});


describe('filter values and visit storage', () => {
  it('accepts color and Working Set status filters only', () => {
    for (const ok of ['#2f7de1', 'status:active', 'status:hold', 'status:done', 'status:none']) expect(validFilter(ok)).toBe(ok);
    for (const bad of ['#2F7DE1x', 'red', 'status:paused', 'status:', 42, null]) expect(validFilter(bad)).toBeNull();
  });

  it('records visits under the device-local key, separate from settings, and clears them', async () => {
    const k = `chatgpt:${ID}`;
    await recordVisitFor(k, 1_800_000_000_000);
    await recordVisitFor(k, 1_800_000_001_000);
    expect(store[VISITS_KEY]).toEqual({ [k]: { first: 1_800_000_000_000, last: 1_800_000_001_000, count: 2 } });
    expect(store[KEY]).toBeUndefined(); // settings untouched
    expect(Object.keys(await loadVisits())).toEqual(Date.now() - 1_800_000_001_000 > 90 * 86_400_000 ? [] : [k]);
    await clearVisits();
    expect(store[VISITS_KEY]).toBeUndefined();
  });
});