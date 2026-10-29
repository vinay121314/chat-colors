import { describe, expect, it } from 'vitest';
import { VISIT_CAP, VISIT_MAX_AGE_MS, ago, normalizeVisits, recordVisit, revisited } from '../../src/core/visits';

const K = (n: number) => `chatgpt:${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const T0 = 1_800_000_000_000;

describe('Recently Revisited (visits)', () => {
  it('records first visit, then counts revisits and updates last', () => {
    let v = recordVisit({}, K(1), T0);
    expect(v[K(1)]).toEqual({ first: T0, last: T0, count: 1 });
    v = recordVisit(v, K(1), T0 + 5000);
    expect(v[K(1)]).toEqual({ first: T0, last: T0 + 5000, count: 2 });
  });

  it('revisited() lists only chats opened more than once, most recent first', () => {
    let v = recordVisit({}, K(1), T0);
    v = recordVisit(v, K(2), T0 + 1);
    v = recordVisit(v, K(2), T0 + 2);
    v = recordVisit(v, K(1), T0 + 3);
    v = recordVisit(v, K(3), T0 + 4); // once only
    expect(revisited(v).map(([k]) => k)).toEqual([K(1), K(2)]);
  });

  it('is bounded: caps entries (oldest dropped) and expires old visits', () => {
    let v = {};
    for (let i = 0; i < VISIT_CAP + 20; i++) v = recordVisit(v, K(i), T0 + i);
    expect(Object.keys(v)).toHaveLength(VISIT_CAP);
    expect(v).not.toHaveProperty(K(0)); // oldest gone
    expect(v).toHaveProperty(K(VISIT_CAP + 19));
    const expired = normalizeVisits({ [K(1)]: { first: T0, last: T0, count: 3 } }, T0 + VISIT_MAX_AGE_MS + 1);
    expect(expired).toEqual({});
  });

  it('stores ids, timestamps and counts only; drops malformed data', () => {
    const v = normalizeVisits(
      {
        [K(1)]: { first: T0, last: T0, count: 2, title: 'secret' },
        'no-provider-id': { first: T0, last: T0, count: 1 },
        [K(2)]: { first: 'x', last: T0, count: 1 },
        [K(3)]: null,
      },
      T0,
    );
    expect(v).toEqual({ [K(1)]: { first: T0, last: T0, count: 2 } });
    expect(normalizeVisits('garbage')).toEqual({});
    expect(normalizeVisits([1, 2])).toEqual({});
  });

  it('formats relative times', () => {
    expect(ago(T0, T0 + 10_000)).toBe('just now');
    expect(ago(T0, T0 + 5 * 60_000)).toBe('5 min ago');
    expect(ago(T0, T0 + 3 * 3_600_000)).toBe('3 h ago');
    expect(ago(T0, T0 + 2 * 86_400_000)).toBe('2 d ago');
  });
});
