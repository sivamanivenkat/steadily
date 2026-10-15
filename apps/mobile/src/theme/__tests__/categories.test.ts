import { BUILT_IN_CATEGORY_IDS } from '@steadily/taxonomy';

import { categoryColors, categoryPalette } from '../categories';
import { darkColors } from '../colors';

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over opaque `bg`, as #RRGGBB. */
function blend(fg: string, alpha: number, bg: string): string {
  const f = parseInt(fg.slice(1), 16);
  const g = parseInt(bg.slice(1), 16);
  const ch = (shift: number) =>
    Math.round(((f >> shift) & 255) * alpha + ((g >> shift) & 255) * (1 - alpha));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

describe('category colors', () => {
  it('covers exactly the taxonomy built-in ids', () => {
    expect(Object.keys(categoryPalette).sort()).toEqual([...BUILT_IN_CATEGORY_IDS].sort());
  });

  it.each(BUILT_IN_CATEGORY_IDS)('%s ink meets 4.5:1 on its light fill', (id) => {
    const { fill, ink } = categoryPalette[id];
    expect(contrast(ink, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BUILT_IN_CATEGORY_IDS)('%s dark stroke meets 4.5:1 on its dark tile', (id) => {
    const { fill, darkStroke } = categoryPalette[id];
    const tile = blend(fill, 0.14, darkColors.solidSurface);
    expect(contrast(darkStroke, tile)).toBeGreaterThanOrEqual(4.5);
  });

  it('gives dark tiles a translucent fill and custom ids the fallback colors', () => {
    expect(categoryColors('food.coffee', 'dark').fill).toBe('rgba(243,227,207,0.14)');
    expect(categoryColors('custom.kids', 'light')).toEqual(
      categoryColors('other.general', 'light'),
    );
  });
});
