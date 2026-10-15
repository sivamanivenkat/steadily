import { useEffect, type ReactNode } from 'react';
import { Appearance } from 'react-native';

import { ThemePreferenceContext } from '@/theme';

import { DataProvider, useData } from './DataContext';
import type { DataSource } from './DataSource';

/**
 * Applies the Settings theme override app-wide: our tokens through `ThemePreferenceContext`, and
 * native chrome (keyboard, alerts, date pickers) through `Appearance`.
 */
function ThemeFromSettings({ children }: { children: ReactNode }) {
  const { data: settings } = useData((source) => source.getSettings());
  const preference = settings?.theme ?? 'system';

  useEffect(() => {
    try {
      Appearance.setColorScheme(preference === 'system' ? 'auto' : preference);
    } catch {
      // Not available (tests, some platforms): our own tokens still follow the override.
    }
  }, [preference]);

  return (
    <ThemePreferenceContext.Provider value={preference}>{children}</ThemePreferenceContext.Provider>
  );
}

/** Data source + Settings-driven theme. Wraps the whole app (and screens under test). */
export function AppProviders({ source, children }: { source: DataSource; children: ReactNode }) {
  return (
    <DataProvider source={source}>
      <ThemeFromSettings>{children}</ThemeFromSettings>
    </DataProvider>
  );
}
