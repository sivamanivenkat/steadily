import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  AppText,
  ConfirmSheet,
  IconTile,
  ListCard,
  ListRow,
  OnDeviceBadge,
  RadioRow,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
  ToggleRow,
  type IconName,
  type PillTone,
} from '@/components';
import { CLOUD_NEVER_SENT, CLOUD_SENT_SUMMARY } from '@/content/privacy';
import {
  ISSUER_HEALTH_LABEL,
  issuerHealth,
  issuerName,
  useData,
  useDataSource,
  useNow,
} from '@/data';
import type { IssuerHealth, Settings } from '@/data/types';
import { useCaptureConfirmations } from '@/hooks/useCaptureConfirmations';
import { layout, space, useTheme } from '@/theme';

const NOTIFY_OPTIONS: readonly {
  value: Settings['notifyMode'];
  label: string;
  description: string;
}[] = [
  {
    value: 'unsure_only',
    label: 'Only when unsure',
    description: 'Ask about new or unclear charges. Log the rest quietly.',
  },
  {
    value: 'every_transaction',
    label: 'Every transaction',
    description: 'A short note each time something is logged.',
  },
  { value: 'off', label: 'Off', description: 'Check the review queue yourself.' },
];

const THEME_OPTIONS: readonly { value: Settings['theme']; label: string }[] = [
  { value: 'system', label: 'Match phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const HEALTH_PILL: Record<IssuerHealth, { tone: PillTone; icon?: IconName }> = {
  receiving: { tone: 'onTrack', icon: 'check' },
  quiet: { tone: 'headsUp', icon: 'bell' },
  waiting: { tone: 'neutral' },
  not_set_up: { tone: 'neutral' },
};

/** At large text sizes the status pill moves under the name so the name keeps its width. */
const STACK_PILL_FONT_SCALE = 1.3;

/** "22:00" -> "10:00 PM" */
function clockLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

const DEFAULT_QUIET_HOURS = { start: '22:00', end: '07:00' };

/** A row that opens another screen: tile, name, one line of help, chevron. */
function NavRow({
  title,
  subtitle,
  icon,
  tone = 'neutral',
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  tone?: 'neutral' | 'accent' | 'headsUp';
  onPress: () => void;
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      leading={<IconTile icon={icon} tone={tone} />}
      chevron
      onPress={onPress}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    />
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const now = useNow();
  const { data: settings } = useData((s) => s.getSettings());
  const { data: setups } = useData((s) => s.listIssuerSetup());
  const confirmations = useCaptureConfirmations();

  const [seedStatus, setSeedStatus] = useState<string | null>(null);
  const [confirmCloud, setConfirmCloud] = useState(false);

  const update = (patch: Partial<Settings>) => void source.updateSettings(patch);
  const seed = source.seedSampleData;
  const seedSampleData = seed
    ? () => {
        setSeedStatus('Adding sample alerts…');
        seed().then(
          (count) => setSeedStatus(`Added ${count} sample alerts.`),
          () => setSeedStatus('Could not add sample alerts.'),
        );
      }
    : null;
  const selected = setups?.filter((s) => s.selected) ?? [];
  const stackPill = fontScale >= STACK_PILL_FONT_SCALE;
  const reopenSetup = () => void source.saveOnboarding({ completed: false });

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="Settings" onBack={() => router.back()} />

      <SectionLabel>Banks and cards</SectionLabel>
      <ListCard>
        {selected.map((s) => {
          const health = issuerHealth(s, now);
          const name = issuerName(s.issuerId) ?? s.issuerId;
          const pill = <StatusPill label={ISSUER_HEALTH_LABEL[health]} {...HEALTH_PILL[health]} />;
          return (
            <ListRow
              key={s.issuerId}
              title={name}
              trailing={stackPill ? undefined : pill}
              accessibilityLabel={`${name}: ${ISSUER_HEALTH_LABEL[health]}`}
            >
              {stackPill ? pill : null}
            </ListRow>
          );
        })}
        {selected.length === 0 ? (
          <NavRow
            title="Set up alerts"
            subtitle="No banks or cards set up yet."
            icon="bell"
            tone="accent"
            onPress={reopenSetup}
          />
        ) : (
          <NavRow
            title="Continue setup"
            subtitle="Add a bank or card, or finish one you started."
            icon="plus"
            tone="accent"
            onPress={reopenSetup}
          />
        )}
      </ListCard>

      <SectionLabel>Money</SectionLabel>
      <ListCard>
        <NavRow
          title="Subscriptions"
          subtitle="Repeating charges found on this phone"
          icon="repeat"
          onPress={() => router.push('/subscriptions')}
        />
        <NavRow
          title="Spending trends"
          subtitle="This month against last month and your average"
          icon="chart"
          onPress={() => router.push('/trends')}
        />
      </ListCard>

      {settings ? (
        <>
          <SectionLabel>Notifications</SectionLabel>
          <ListCard accessibilityRole="radiogroup" accessibilityLabel="When to notify">
            {NOTIFY_OPTIONS.map((option) => (
              <RadioRow
                key={option.value}
                label={option.label}
                description={option.description}
                selected={settings.notifyMode === option.value}
                onPress={() => update({ notifyMode: option.value })}
              />
            ))}
          </ListCard>
          <ListCard>
            <ToggleRow
              label="Daily summary"
              description="One evening note with the day's total."
              value={settings.dailySummary}
              onValueChange={(dailySummary) => update({ dailySummary })}
            />
            <ToggleRow
              label="Quiet hours"
              description={
                settings.quietHours
                  ? `No notifications from ${clockLabel(settings.quietHours.start)} to ${clockLabel(settings.quietHours.end)}.`
                  : 'Notifications can arrive at any time.'
              }
              value={settings.quietHours !== null}
              onValueChange={(on) => update({ quietHours: on ? DEFAULT_QUIET_HOURS : null })}
            />
            {confirmations.available ? (
              <ToggleRow
                label="Confirm each logged purchase"
                description={'A quiet "Logged $X at Y" note on this phone after each alert.'}
                value={confirmations.enabled}
                onValueChange={confirmations.setEnabled}
              />
            ) : null}
            {confirmations.available && confirmations.enabled && !confirmations.canPost ? (
              <NavRow
                title={
                  confirmations.needsPermission && !confirmations.blocked
                    ? 'Allow notifications'
                    : 'Open app settings'
                }
                subtitle="Notifications are off for Steadily, so confirmations can't show."
                icon="bell"
                tone="headsUp"
                onPress={() => void confirmations.allow()}
              />
            ) : null}
          </ListCard>

          <SectionLabel>Cloud AI</SectionLabel>
          <ListCard>
            <View>
              <ToggleRow
                label="Use cloud AI"
                description="For unclear merchants and your questions in Ask."
                value={settings.cloudAiOptIn}
                onValueChange={(on) =>
                  on ? setConfirmCloud(true) : update({ cloudAiOptIn: false })
                }
              />
              <View style={styles.explain}>
                <AppText variant="caption" color={colors.ink2}>
                  {settings.cloudAiOptIn ? 'On. ' : 'Off. Everything is worked out on this phone. '}
                  {CLOUD_SENT_SUMMARY}
                </AppText>
                <AppText variant="caption" color={colors.ink2}>
                  {CLOUD_NEVER_SENT}
                </AppText>
              </View>
            </View>
          </ListCard>

          <SectionLabel>Appearance</SectionLabel>
          <ListCard accessibilityRole="radiogroup" accessibilityLabel="Theme">
            {THEME_OPTIONS.map((option) => (
              <RadioRow
                key={option.value}
                label={option.label}
                selected={settings.theme === option.value}
                onPress={() => update({ theme: option.value })}
              />
            ))}
          </ListCard>
        </>
      ) : null}

      <ConfirmSheet
        visible={confirmCloud}
        title="Turn on cloud AI?"
        body={[
          'What is sent: the text of your question, plus totals only. No individual transactions, no notes, no names of people you paid. Local business names are grouped as “Other merchants”.',
          'It goes through Steadily’s server to a cloud AI model. You can turn this off at any time, and answers then stay on this phone.',
        ]}
        confirmLabel="Turn on cloud AI"
        cancelLabel="Keep it on this phone"
        onConfirm={() => {
          setConfirmCloud(false);
          update({ cloudAiOptIn: true });
        }}
        onCancel={() => setConfirmCloud(false)}
      />

      <SectionLabel>Your data</SectionLabel>
      <ListCard>
        <NavRow
          title="Import from CSV"
          subtitle="Add past transactions from a bank's CSV export, read on this phone"
          icon="arrowDown"
          onPress={() => router.push('/import-csv')}
        />
        <NavRow
          title="Export CSV"
          subtitle="Save your transactions to a file you can share"
          icon="arrowUp"
          onPress={() => router.push('/export-csv')}
        />
      </ListCard>

      <SectionLabel>Privacy</SectionLabel>
      <ListCard>
        <View style={styles.privacy}>
          <OnDeviceBadge />
          <AppText variant="body" color={colors.ink2}>
            Alerts are read on this phone and the text is deleted. Open any transaction to see
            exactly what we kept.
          </AppText>
        </View>
        <NavRow
          title="Privacy & data"
          subtitle="What is stored on this phone, and deleting it"
          icon="lock"
          onPress={() => router.push('/privacy')}
        />
      </ListCard>

      {__DEV__ ? (
        <>
          <SectionLabel>Developer</SectionLabel>
          <ListCard>
            <ListRow title="Reopen onboarding" chevron onPress={reopenSetup} />
            <ListRow
              title="Restart onboarding from the beginning"
              chevron
              onPress={() => void source.saveOnboarding({ completed: false, step: 'welcome' })}
            />
            {seedSampleData ? (
              <View>
                <ListRow
                  title="Seed sample data"
                  onPress={seedSampleData}
                  accessibilityLabel="Seed sample data"
                  accessibilityHint="Runs made-up bank alerts through the on-device pipeline"
                />
                {seedStatus ? (
                  <AppText
                    variant="caption"
                    color={colors.ink2}
                    accessibilityLiveRegion="polite"
                    style={styles.seedStatus}
                  >
                    {seedStatus}
                  </AppText>
                ) : null}
              </View>
            ) : null}
          </ListCard>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  explain: { gap: space.sm, paddingTop: space.xs, paddingBottom: space.md },
  privacy: { gap: space.sm, paddingVertical: space.md, minHeight: layout.rowMinHeight },
  seedStatus: { paddingBottom: space.md },
});
