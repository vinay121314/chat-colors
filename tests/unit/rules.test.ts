import { describe, expect, it } from 'vitest';
import { matchCategory, resolveColor } from '../../src/core/rules';
import { NEUTRAL, NONE, PALETTE, defaultSettings } from '../../src/core/schema';

const ID = '11111111-1111-4111-8111-111111111111';

describe('resolveColor precedence', () => {
  it('manual override beats a matching rule', () => {
    const s = defaultSettings();
    s.overrides[ID] = '#ff00ff';
    expect(resolveColor(ID, 'Fix python bug', s)).toEqual({ color: '#ff00ff', source: 'manual' });
  });

  it('manual NONE removes the color even when a rule matches', () => {
    const s = defaultSettings();
    s.overrides[ID] = NONE;
    expect(resolveColor(ID, 'urgent', s)).toEqual({ color: null, source: 'manual' });
  });

  it('falls back to neutral, or to nothing when fallback is NONE', () => {
    const s = defaultSettings();
    expect(resolveColor(ID, 'Hello there', s)).toEqual({ color: NEUTRAL, source: 'fallback' });
    s.fallback = NONE;
    expect(resolveColor(ID, 'Hello there', s).color).toBeNull();
  });

  it('override lookup is case-insensitive on the id', () => {
    const s = defaultSettings();
    s.overrides[ID] = '#000000';
    expect(resolveColor(ID.toUpperCase(), '', s).source).toBe('manual');
  });
});

describe('keyword matching', () => {
  it('is case-insensitive substring matching', () => {
    expect(matchCategory('Fix TYPESCRIPT build', defaultSettings().categories)?.name).toBe('Development');
  });

  it('uses category order as priority', () => {
    const s = defaultSettings();
    const title = 'URGENT: python bug';
    expect(matchCategory(title, s.categories)?.name).toBe('Development');
    const urgent = s.categories.findIndex((c) => c.name === 'Urgent');
    s.categories.unshift(...s.categories.splice(urgent, 1));
    expect(matchCategory(title, s.categories)?.name).toBe('Urgent');
  });

  it('skips disabled categories and disabled rules', () => {
    const s = defaultSettings();
    const dev = s.categories.find((c) => c.name === 'Development')!;
    dev.rules.find((r) => r.keyword === 'python')!.enabled = false;
    expect(matchCategory('python notes', s.categories)).toBeUndefined();
    dev.rules.find((r) => r.keyword === 'python')!.enabled = true;
    dev.enabled = false;
    expect(matchCategory('python notes', s.categories)).toBeUndefined();
  });

  it('supports multiple keywords per category', () => {
    const work = defaultSettings().categories.filter((c) => c.name === 'Work');
    expect(matchCategory('client sync', work)?.name).toBe('Work');
    expect(matchCategory('weekly report', work)?.name).toBe('Work');
  });

  it('re-classifies on title change, manual stays stable', () => {
    const s = defaultSettings();
    expect(resolveColor(ID, 'python', s).category?.name).toBe('Development');
    expect(resolveColor(ID, 'trip travel plan', s).category?.name).toBe('Personal');
    s.overrides[ID] = '#abcdef';
    expect(resolveColor(ID, 'python', s).color).toBe('#abcdef');
    expect(resolveColor(ID, 'anything else', s).color).toBe('#abcdef');
  });
});

// WCAG 1.4.11 non-text contrast >= 3:1 against ChatGPT-like light (#fff) and dark (#212121, #171717) sidebars.
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};

describe('default palette contrast (light and dark themes)', () => {
  const colors = [...new Set([...PALETTE, NEUTRAL, ...defaultSettings().categories.map((c) => c.color)])];
  it.each(colors)('%s is >= 3:1 on light and dark sidebars', (c) => {
    for (const bg of ['#ffffff', '#212121', '#171717']) expect(contrast(c, bg)).toBeGreaterThanOrEqual(3);
  });
  it('palette has at least 8 distinct colors', () => expect(new Set(PALETTE).size).toBeGreaterThanOrEqual(8));
});
