import type { CategoryIcon } from '@steadily/taxonomy';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { iconSize, iconStroke } from '@/theme';

/** One stroke primitive in a 24x24 box: a path, or a circle as [cx, cy, r]. */
type Shape = string | readonly [number, number, number];

type UiIcon =
  | 'check'
  | 'settings'
  | 'home'
  | 'activity'
  | 'budgets'
  | 'ask'
  | 'chevronRight'
  | 'chevronLeft'
  | 'arrowUp'
  | 'inbox'
  | 'lock'
  | 'search'
  | 'close'
  | 'plus'
  | 'bell'
  | 'battery'
  | 'phone';

export type IconName = CategoryIcon | UiIcon;

/**
 * Line icons drawn for Steadily: 24x24 grid, round caps and joins, no fills. Category icons are
 * keyed by the taxonomy's `icon` field, so the record must cover every one of them.
 */
const shapes: Record<IconName, readonly Shape[]> = {
  // Category icons
  cart: [
    'M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.4-1.1L20 8H6',
    [9, 20, 1.2],
    [17, 20, 1.2],
  ],
  utensils: ['M5 3v5a2.5 2.5 0 0 0 5 0V3', 'M7.5 3v18', 'M18 3c-2.2 1.4-3.5 4-3.5 7.5H18V21'],
  coffee: [
    'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z',
    'M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16',
    'M8 3.5v2.5',
    'M12 3.5v2.5',
  ],
  car: [
    'M5 17H4a1 1 0 0 1-1-1v-3.5l2.2-5.2A2 2 0 0 1 7.1 6h9.8a2 2 0 0 1 1.9 1.3L21 12.5V16a1 1 0 0 1-1 1h-1',
    'M9.5 17h5',
    'M3.5 12.5h17',
    [7.5, 17, 2],
    [16.5, 17, 2],
  ],
  fuel: [
    'M4.5 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16',
    'M3 21h12',
    'M4.5 10h9',
    'M13.5 8H16a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8.5L18.5 6',
  ],
  bag: ['M5 8h14l-1 12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z', 'M9 10.5V6a3 3 0 0 1 6 0v4.5'],
  bolt: ['M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z'],
  home: ['M3.5 11 12 4l8.5 7', 'M5.5 9.5V20h13V9.5', 'M10 20v-5.5h4V20'],
  play: [[12, 12, 9], 'M10 8.8v6.4l5.5-3.2z'],
  heart: [
    'M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z',
  ],
  ticket: [
    'M4 6.5h16V10a2 2 0 0 0 0 4v3.5H4V14a2 2 0 0 0 0-4z',
    'M14.5 6.5v2',
    'M14.5 11v2',
    'M14.5 15.5v2',
  ],
  plane: [
    'M12 2.5c.8 0 1.5.7 1.5 1.5v5l7 4.3V16l-7-2.3v4.1l2 1.5V21L12 20l-3.5 1v-1.7l2-1.5v-4.1l-7 2.3v-2.7l7-4.3V4c0-.8.7-1.5 1.5-1.5z',
  ],
  sparkle: [
    'M11 3.5l1.8 5.2 5.2 1.8-5.2 1.8L11 17.5l-1.8-5.2L4 10.5l5.2-1.8z',
    'M18.5 15.5v5',
    'M16 18h5',
  ],
  gift: [
    'M4.5 11h15v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z',
    'M3.5 7.5h17V11h-17z',
    'M12 7.5v13',
    'M12 7.5C11 4.5 7.5 3.5 7.5 5.8S10.5 7.5 12 7.5zm0 0c1-3 4.5-4 4.5-1.7S13.5 7.5 12 7.5z',
  ],
  dots: [
    [6, 12, 1.1],
    [12, 12, 1.1],
    [18, 12, 1.1],
  ],
  // Interface icons
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  settings: [
    'M4 7.5h9',
    'M18 7.5h2',
    [15.5, 7.5, 2.5],
    'M4 16.5h3',
    'M12 16.5h8',
    [9.5, 16.5, 2.5],
  ],
  activity: ['M9 6.5h11', 'M9 12h11', 'M9 17.5h11', [4.5, 6.5, 1], [4.5, 12, 1], [4.5, 17.5, 1]],
  budgets: ['M11 4a8.5 8.5 0 1 0 9 9h-9z', 'M14.5 3.5a7 7 0 0 1 6 6h-6z'],
  ask: [
    'M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9.5L5 20v-4h.5A1.5 1.5 0 0 1 4 14.5z',
    'M8.5 10h7',
  ],
  chevronRight: ['M9.5 6l6 6-6 6'],
  chevronLeft: ['M14.5 6l-6 6 6 6'],
  arrowUp: ['M12 19V5.5', 'M6.5 11 12 5.5l5.5 5.5'],
  inbox: [
    'M4 13l2.4-6.6A1 1 0 0 1 7.3 5.8h9.4a1 1 0 0 1 .9.6L20 13v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
    'M4 13h4.5a3.5 3.5 0 0 0 7 0H20',
  ],
  lock: [
    'M6.5 11h11a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z',
    'M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
    'M12 15v2',
  ],
  search: [[10.5, 10.5, 6], 'M15 15l5 5'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  plus: ['M12 5.5v13', 'M5.5 12h13'],
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  battery: [
    'M4 8h13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z',
    'M21 10.5v3',
    'M6.5 11v2',
    'M9.5 11v2',
  ],
  phone: [
    'M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z',
    'M11 18h2',
  ],
};

type IconProps = {
  name: IconName;
  color: string;
  size?: number;
  strokeWidth?: number;
};

/** Decorative by default: callers put the meaning in visible text or the control's label. */
export function Icon({ name, color, size = iconSize.md, strokeWidth = iconStroke }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <G
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shapes[name].map((shape, i) =>
          typeof shape === 'string' ? (
            <Path key={i} d={shape} />
          ) : (
            <Circle key={i} cx={shape[0]} cy={shape[1]} r={shape[2]} />
          ),
        )}
      </G>
    </Svg>
  );
}
