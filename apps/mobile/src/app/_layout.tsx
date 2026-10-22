import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components';
import { AppProviders, useData } from '@/data';
import { useAppDataSource } from '@/data/appDataSource';
import { fontFamily, space, useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden (e.g. fast refresh): nothing to do.
});

function RootNavigator() {
  const theme = useTheme();
  const [fontsLoaded, fontError] = useFonts({
    [fontFamily.regular]: PlusJakartaSans_400Regular,
    [fontFamily.medium]: PlusJakartaSans_500Medium,
    [fontFamily.semibold]: PlusJakartaSans_600SemiBold,
    [fontFamily.bold]: PlusJakartaSans_700Bold,
    [fontFamily.extrabold]: PlusJakartaSans_800ExtraBold,
  });
  const { data: onboarding } = useData((source) => source.getOnboarding());
  const { data: settings } = useData((source) => source.getSettings());
  const ready = (fontsLoaded || fontError !== null) && onboarding !== undefined && !!settings;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  const onboarded = onboarding.completed;
  const navigationTheme = theme.scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider
      value={{
        ...navigationTheme,
        colors: { ...navigationTheme.colors, background: theme.colors.ground },
      }}
    >
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={onboarded}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="review" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="trends" />
          <Stack.Screen name="subscriptions" />
          <Stack.Screen name="transaction/[id]" options={{ presentation: 'modal' }} />
          <Stack.Screen name="budget-edit" options={{ presentation: 'modal' }} />
          <Stack.Screen name="add" options={{ presentation: 'modal' }} />
          <Stack.Screen name="import-csv" options={{ presentation: 'modal' }} />
          <Stack.Screen name="export-csv" options={{ presentation: 'modal' }} />
        </Stack.Protected>
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

/** Shown if the encrypted database cannot be opened. No details: they could echo data. */
function StorageError() {
  const { colors } = useTheme();
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  return (
    <View style={[styles.error, { backgroundColor: colors.ground }]} accessibilityRole="alert">
      <AppText variant="heading">Steadily could not open its secure storage</AppText>
      <AppText variant="body" color={colors.ink2}>
        Your data stays encrypted on this phone. Close the app and open it again.
      </AppText>
    </View>
  );
}

export default function RootLayout() {
  // The encrypted on-device database and agent runtime; the splash stays up while it opens.
  const data = useAppDataSource();
  if (data.status === 'loading') return null;
  if (data.status === 'error') return <StorageError />;
  return (
    <AppProviders source={data.source}>
      <RootNavigator />
    </AppProviders>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', gap: space.sm, padding: space.xl },
});
