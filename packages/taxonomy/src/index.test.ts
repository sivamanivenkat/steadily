import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CATEGORY_IDS,
  CATEGORIES,
  FALLBACK_CATEGORY_ID,
  isCategoryId,
  isCustomCategoryId,
  toCustomCategoryId,
} from './index';

describe('taxonomy', () => {
  it('ships exactly 15 built-in categories with unique ids and names', () => {
    expect(CATEGORIES).toHaveLength(15);
    expect(new Set(BUILT_IN_CATEGORY_IDS).size).toBe(15);
    expect(new Set(CATEGORIES.map((c) => c.name)).size).toBe(15);
  });

  it('uses hierarchy-ready group.name ids', () => {
    for (const id of BUILT_IN_CATEGORY_IDS) {
      expect(id).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });

  it('includes the fallback category', () => {
    expect(isCategoryId(FALLBACK_CATEGORY_ID)).toBe(true);
  });

  it('validates built-in and custom ids', () => {
    expect(isCategoryId('food.coffee')).toBe(true);
    expect(isCategoryId('custom.kids_stuff')).toBe(true);
    expect(isCategoryId('food.unknown')).toBe(false);
    expect(isCategoryId('custom.Bad Id')).toBe(false);
    expect(isCustomCategoryId('custom.')).toBe(false);
  });

  it('slugs user names into custom ids', () => {
    expect(toCustomCategoryId("Kids' Stuff")).toBe('custom.kids_stuff');
    expect(toCustomCategoryId('  Café  Runs ')).toBe('custom.cafe_runs');
    expect(() => toCustomCategoryId('!!!')).toThrow();
  });
});
