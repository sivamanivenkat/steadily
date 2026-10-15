import { useRouter } from 'expo-router';

import { IconButton, PlaceholderScreen } from '@/components';

export default function SettingsScreen() {
  const router = useRouter();
  return (
    <PlaceholderScreen
      title="Settings"
      heading="Coming soon"
      body="Issuer status, notifications, cloud AI opt-in, import and export, and what we keep."
      withTabBar={false}
      header={
        <IconButton icon="chevronLeft" accessibilityLabel="Back" onPress={() => router.back()} />
      }
    />
  );
}
