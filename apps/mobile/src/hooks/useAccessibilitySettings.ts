import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type Setting = {
  query: () => Promise<boolean>;
  event: 'reduceMotionChanged' | 'reduceTransparencyChanged';
};

const REDUCE_MOTION: Setting = {
  query: () => AccessibilityInfo.isReduceMotionEnabled(),
  event: 'reduceMotionChanged',
};

const REDUCE_TRANSPARENCY: Setting = {
  query: () => AccessibilityInfo.isReduceTransparencyEnabled(),
  event: 'reduceTransparencyChanged',
};

function useAccessibilitySetting({ query, event }: Setting): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    query()
      .then((value) => {
        if (mounted) setEnabled(value);
      })
      .catch(() => {
        // Unsupported on this platform: keep the default.
      });
    const subscription = AccessibilityInfo.addEventListener(event, setEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [query, event]);

  return enabled;
}

/** True when the user asked the OS to reduce motion. Animations should become fades or nothing. */
export function useReduceMotion(): boolean {
  return useAccessibilitySetting(REDUCE_MOTION);
}

/** True when the user asked the OS to reduce transparency (iOS). Glass becomes solid. */
export function useReduceTransparency(): boolean {
  return useAccessibilitySetting(REDUCE_TRANSPARENCY);
}
