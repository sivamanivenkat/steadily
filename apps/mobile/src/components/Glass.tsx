import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useReduceTransparency } from '@/hooks/useAccessibilitySettings';
import {
  defaultElevation,
  radius as radii,
  useTheme,
  type Elevation,
  type GlassVariant,
} from '@/theme';

type GlassProps = {
  variant?: GlassVariant;
  radius?: number;
  /**
   * Small surfaces that stay put (tab bar, toast). On Android only these get the translucent
   * glass tint; large or scrolling surfaces use the solid surface there, since real blur is
   * expensive and needs a blur target.
   */
  fixed?: boolean;
  /**
   * Shadow tier. Defaults to `raised` for `strong` glass and `soft` for `light` glass, so key
   * amounts lift above lists.
   */
  elevation?: Elevation;
  /** `false` is shorthand for `elevation="none"`. */
  shadow?: boolean;
  /** Outer layout (margins, flex, size). */
  style?: StyleProp<ViewStyle>;
  /** Inner content layout (padding, direction, alignment). */
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

function canUseLiquidGlass(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

const liquidGlass = canUseLiquidGlass();

/**
 * The one glass surface. Screens never touch the blur libraries directly.
 *
 * - iOS 26+ with Liquid Glass: native `GlassView`, tinted with the variant color.
 * - Other iOS: `BlurView` with the variant tint on top.
 * - Android: translucent tint for small fixed surfaces, solid surface otherwise.
 * - Reduce Transparency: solid surface everywhere.
 */
export function Glass({
  variant = 'light',
  radius = radii.cardSmall,
  fixed = false,
  elevation,
  shadow = true,
  style,
  contentStyle,
  children,
}: GlassProps) {
  const theme = useTheme();
  const reduceTransparency = useReduceTransparency();
  const tokens = theme.glass[variant];
  const lift = shadow ? (elevation ?? defaultElevation[variant]) : 'none';
  const boxShadow = lift === 'none' ? undefined : theme.shadows[lift];

  const solid = reduceTransparency || (Platform.OS === 'android' && !fixed);
  const surface: ViewStyle = solid
    ? { backgroundColor: theme.colors.solidSurface, borderColor: theme.colors.solidBorder }
    : { borderColor: tokens.border };

  let backdrop: ReactNode = null;
  if (!solid) {
    if (liquidGlass) {
      backdrop = (
        <GlassView
          style={StyleSheet.absoluteFill}
          glassEffectStyle="regular"
          colorScheme={theme.scheme}
          tintColor={tokens.background}
        />
      );
    } else if (Platform.OS === 'ios') {
      backdrop = (
        <>
          <BlurView
            style={StyleSheet.absoluteFill}
            intensity={tokens.blurIntensity}
            tint={theme.scheme === 'dark' ? 'dark' : 'light'}
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.background }]} />
        </>
      );
    } else {
      backdrop = <View style={[StyleSheet.absoluteFill, { backgroundColor: tokens.background }]} />;
    }
  }

  return (
    <View
      // The shadow lives on an outer view so the inner `overflow: hidden` does not clip it.
      style={[{ borderRadius: radius }, boxShadow !== undefined && { boxShadow }, style]}
    >
      <View style={[styles.clip, surface, { borderRadius: radius }, contentStyle]}>
        {backdrop}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
