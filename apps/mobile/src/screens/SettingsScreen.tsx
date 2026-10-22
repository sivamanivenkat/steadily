import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  ConfirmSheet,
  Glass,
  OnDeviceBadge,
  RadioRow,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
  ToggleRow,
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
import type { Settings } from '@/data/types';
import { useCaptureConfirmations } from '@/hooks/useCaptureConfirmations';
import { layout, radius, space, useTheme } from '@/theme';

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

/** "22:00" -> "10:00 PM" */
function clockLabel(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

const DEFAULT_QUIET_HOURS = { start: '22:00', end: '07:00' };

function Card({ children }: { children: ReactNode }) {
  return (
    <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
      {children}
    </Glass>
  );
}

function Divided({ children }: { children: ReactNode[] }) {
  const { colors } = useTheme();
  return (
    <>
      {children
        .filter((child) => child !== null && child !== false)
        .map((child, i) => (
          <View key={i} style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}>
            {child}
          </View>
        ))}
    </>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
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

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="Settings" onBack={() => router.back()} />

      <SectionLabel>Banks and cards</SectionLabel>
      <Card>
        {selected.length === 0 ? (
          <AppText variant="body" color={colors.ink2} style={styles.padded}>
            No banks or cards set up yet.
          </AppText>
        ) : (
          <Divided>
            {selected.map((s) => {
              const health = issuerHealth(s, now);
              return (
                <View
                  key={s.issuerId}
                  style={styles.issuerRow}
                  accessible
                  accessibilityLabel={`${issuerName(s.issuerId)}: ${ISSUER_HEALTH_LABEL[health]}`}
                >
                  <AppText variant="bodyStrong" style={styles.flex}>
                    {issuerName(s.issuerId)}
                  </AppText>
                  <StatusPill
                    label={ISSUER_HEALTH_LABEL[health]}
                    tone={
                      health === 'receiving'
                        ? 'onTrack'
                        : health === 'quiet'
                          ? 'headsUp'
                          : 'neutral'
                    }
                    icon={
                      health === 'receiving' ? 'check' : health === 'quiet' ? 'bell' : undefined
                    }
                  />
                </View>
              );
            })}
          </Divided>
        )}
        <Button
          label={selected.length === 0 ? 'Set up alerts' : 'Continue setup'}
          variant="link"
          onPress={() => void source.saveOnboarding({ completed: false })}
          accessibilityHint="Opens the alert setup guide where you left off"
          style={styles.linkStart}
        />
      </Card>

      <SectionLabel>Money</SectionLabel>
      <Card>
        <Divided>
          <Button
            label="Subscriptions"
            variant="link"
            accessibilityHint="Repeating charges found on this phone"
            onPress={() => router.push('/subscriptions')}
            style={styles.linkStart}
          />
          <Button
            label="Spending trends"
            variant="link"
            onPress={() => router.push('/trends')}
            style={styles.linkStart}
          />
        </Divided>
      </Card>

      {settings ? (
        <>
          <SectionLabel>Notifications</SectionLabel>
          <Card>
            <View accessibilityRole="radiogroup" accessibilityLabel="When to notify">
              <Divided>
                {NOTIFY_OPTIONS.map((option) => (
                  <RadioRow
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    selected={settings.notifyMode === option.value}
                    onPress={() => update({ notifyMode: option.value })}
                  />
                ))}
              </Divided>
            </View>
          </Card>
          <Card>
            <Divided>
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
            </Divided>
          </Card>
          {confirmations.available ? (
            <Card>
              <Divided>
                <ToggleRow
                  label="Confirm each logged purchase"
                  description={'A quiet "Logged $X at Y" note on this phone after each alert.'}
                  value={confirmations.enabled}
                  onValueChange={confirmations.setEnabled}
                />
                {confirmations.enabled && !confirmations.canPost ? (
                  <View style={styles.explain}>
                    <AppText variant="caption" color={colors.headsUp.text}>
                      Notifications are off for Steadily, so confirmations can't show.
                    </AppText>
                    <Button
                      label={
                        confirmations.needsPermission && !confirmations.blocked
                          ? 'Allow notifications'
                          : 'Open app settings'
                      }
                      variant="link"
                      onPress={() => void confirmations.allow()}
                      style={styles.linkStart}
                    />
                  </View>
                ) : null}
              </Divided>
            </Card>
          ) : null}

          <SectionLabel>Cloud AI</SectionLabel>
          <Card>
            <ToggleRow
              label="Use cloud AI"
              description="For unclear merchants and your questions in Ask."
              value={settings.cloudAiOptIn}
              onValueChange={(on) => (on ? setConfirmCloud(true) : update({ cloudAiOptIn: false }))}
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
          </Card>

          <SectionLabel>Appearance</SectionLabel>
          <Card>
            <View accessibilityRole="radiogroup" accessibilityLabel="Theme">
              <Divided>
                {THEME_OPTIONS.map((option) => (
                  <RadioRow
                    key={option.value}
                    label={option.label}
                    selected={settings.theme === option.value}
                    onPress={() => update({ theme: option.value })}
                  />
                ))}
              </Divided>
            </View>
          </Card>
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
      <Card>
        <Divided>
          <Button
            label="Import from CSV"
            variant="link"
            onPress={() => router.push('/import-csv')}
            accessibilityHint="Adds past transactions from a bank's CSV export, read on this phone"
            style={styles.linkStart}
          />
          <Button
            label="Export CSV"
            variant="link"
            onPress={() => router.push('/export-csv')}
            accessibilityHint="Saves your transactions to a file you can share"
            style={styles.linkStart}
          />
        </Divided>
      </Card>

      <SectionLabel>Privacy</SectionLabel>
      <Card>
        <View style={styles.privacy}>
          <OnDeviceBadge />
          <AppText variant="body" color={colors.ink2}>
            Alerts are read on this phone and the text is deleted. Open any transaction to see
            exactly what we kept.
          </AppText>
        </View>
        <Button
          label="Privacy & data"
          variant="link"
          onPress={() => router.push('/privacy')}
          accessibilityHint="What is stored on this phone, and deleting it"
          style={styles.linkStart}
        />
      </Card>

      {__DEV__ ? (
        <>
          <SectionLabel>Developer</SectionLabel>
          <Card>
            <Divided>
              <Button
                label="Reopen onboarding"
                variant="link"
                onPress={() => void source.saveOnboarding({ completed: false })}
                style={styles.linkStart}
              />
              <Button
                label="Restart onboarding from the beginning"
                variant="link"
                onPress={() => void source.saveOnboarding({ completed: false, step: 'welcome' })}
                style={styles.linkStart}
              />
              {seedSampleData ? (
                <View>
                  <Button
                    label="Seed sample data"
                    variant="link"
                    onPress={seedSampleData}
                    accessibilityHint="Runs made-up bank alerts through the on-device pipeline"
                    style={styles.linkStart}
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
            </Divided>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  padded: { paddingVertical: space.md },
  issuerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchTarget,
    paddingVertical: space.sm,
  },
  linkStart: { alignSelf: 'flex-start', marginLeft: -space.lg },
  explain: { gap: space.sm, paddingBottom: space.md },
  privacy: { gap: space.sm, paddingVertical: space.md },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  seedStatus: { paddingBottom: space.md },
});
