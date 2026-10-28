import { NONE, type Category, type Settings } from './schema';

export type Source = 'manual' | 'rule' | 'fallback';

export interface Resolved {
  /** #rrggbb, or null for "no border". */
  color: string | null;
  source: Source;
  category?: Category;
}

/** First enabled category (in priority order) with an enabled keyword contained in the title. */
export function matchCategory(title: string, categories: Category[]): Category | undefined {
  const t = title.toLocaleLowerCase();
  return categories.find(
    (c) => c.enabled && c.rules.some((r) => r.enabled && t.includes(r.keyword.toLocaleLowerCase())),
  );
}

/** Precedence: manual override > first matching enabled rule > fallback. */
export function resolveColor(id: string, title: string, s: Settings): Resolved {
  const o = s.overrides[id.toLowerCase()];
  if (o) return { color: o === NONE ? null : o, source: 'manual' };
  const category = matchCategory(title, s.categories);
  if (category) return { color: category.color, source: 'rule', category };
  return { color: s.fallback === NONE ? null : s.fallback, source: 'fallback' };
}
