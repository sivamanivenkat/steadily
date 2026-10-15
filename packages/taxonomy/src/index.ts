/**
 * Steadily spending categories (MVP: 15 flat categories).
 *
 * IDs use `group.name` form so subcategories can be added later without
 * migrating stored transactions or user rules. IDs are a contract: never
 * rename or remove one; add new ones instead.
 */

export const CATEGORIES = [
  { id: 'food.groceries', name: 'Groceries', icon: 'cart' },
  { id: 'food.dining', name: 'Dining Out', icon: 'utensils' },
  { id: 'food.coffee', name: 'Coffee', icon: 'coffee' },
  { id: 'transport.general', name: 'Transport', icon: 'car' },
  { id: 'transport.gas', name: 'Gas', icon: 'fuel' },
  { id: 'shopping.general', name: 'Shopping', icon: 'bag' },
  { id: 'bills.utilities', name: 'Bills & Utilities', icon: 'bolt' },
  { id: 'housing.rent_mortgage', name: 'Rent & Mortgage', icon: 'home' },
  { id: 'subscriptions.general', name: 'Subscriptions', icon: 'play' },
  { id: 'health.general', name: 'Health', icon: 'heart' },
  { id: 'entertainment.general', name: 'Entertainment', icon: 'ticket' },
  { id: 'travel.general', name: 'Travel', icon: 'plane' },
  { id: 'personal_care.general', name: 'Personal Care', icon: 'sparkle' },
  { id: 'gifts.general', name: 'Gifts & Giving', icon: 'gift' },
  { id: 'other.general', name: 'Other', icon: 'dots' },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type BuiltInCategoryId = Category['id'];
export type CategoryIcon = Category['icon'];

/** User-created categories: `custom.<slug>`. */
export type CustomCategoryId = `custom.${string}`;
export type CategoryId = BuiltInCategoryId | CustomCategoryId;

export const BUILT_IN_CATEGORY_IDS: readonly BuiltInCategoryId[] = CATEGORIES.map((c) => c.id);

/** Where uncategorizable spending lands. */
export const FALLBACK_CATEGORY_ID: BuiltInCategoryId = 'other.general';

const CUSTOM_ID_PATTERN = /^custom\.[a-z0-9_]{1,40}$/;
const builtInIds = new Set<string>(BUILT_IN_CATEGORY_IDS);

export function isBuiltInCategoryId(value: string): value is BuiltInCategoryId {
  return builtInIds.has(value);
}

export function isCustomCategoryId(value: string): value is CustomCategoryId {
  return CUSTOM_ID_PATTERN.test(value);
}

export function isCategoryId(value: string): value is CategoryId {
  return isBuiltInCategoryId(value) || isCustomCategoryId(value);
}

export function getBuiltInCategory(id: BuiltInCategoryId): Category {
  const category = CATEGORIES.find((c) => c.id === id);
  if (!category) throw new Error(`Unknown category id: ${id}`);
  return category;
}

/** Turns a user-entered name into a custom category ID, e.g. "Kids' Stuff" -> "custom.kids_stuff". */
export function toCustomCategoryId(name: string): CustomCategoryId {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!slug) throw new Error('Category name must contain letters or digits');
  return `custom.${slug}`;
}
