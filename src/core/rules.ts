import { NONE, normalizeId, type Category, type Settings } from './schema';

export type Source = 'manual' | 'group' | 'rule' | 'fallback';

export interface Resolved {
  /** #rrggbb, or null for "no color". */
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

/**
 * Precedence: manual override > Project/GPT color > first matching enabled rule > fallback.
 * `group` is the Project/GPT id the chat lives in (from its URL), if any.
 */
export function resolveColor(id: string, title: string, s: Settings, group?: string | null): Resolved {
  const o = s.overrides[normalizeId(id) ?? id];
  if (o) return { color: o === NONE ? null : o, source: 'manual' };
  const g = group ? s.groups[group] : undefined;
  if (g) return { color: g.color, source: 'group' };
  const category = matchCategory(title, s.categories);
  if (category) return { color: category.color, source: 'rule', category };
  return { color: s.fallback === NONE ? null : s.fallback, source: 'fallback' };
}
