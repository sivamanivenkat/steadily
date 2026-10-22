import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import {
  AppText,
  Button,
  Glass,
  OnDeviceBadge,
  Screen,
  ScreenHeader,
  SectionLabel,
  StatusPill,
} from '@/components';
import { listenedBankApps, textMessageAppNames } from '@/content/listenedApps';
import { CLOUD_NEVER_SENT, CLOUD_SENT_SUMMARY } from '@/content/privacy';
import { useData, useDataSource } from '@/data';
import { layout, radius, space, type, useTheme } from '@/theme';

/** What the user types to confirm "Delete all my data". */
export const DELETE_CONFIRM_WORD = 'DELETE';

type DeleteState = 'idle' | 'confirming' | 'deleting' | 'failed';

function Card({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <Glass
      variant={strong ? 'strong' : 'light'}
      radius={radius.cardSmall}
      contentStyle={styles.card}
    >
      {children}
    </Glass>
  );
}

function CountRow({ label, count }: { label: string; count: number | undefined }) {
  const { colors } = useTheme();
  const value = count === undefined ? '…' : String(count);
  return (
    <View
      style={[styles.countRow, { borderTopColor: colors.hairline }]}
      accessible
      accessibilityLabel={`${label}: ${count === undefined ? 'loading' : count}`}
    >
      <AppText variant="body" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="amount">{value}</AppText>
    </View>
  );
}

/**
 * "Privacy & data" (D-011): what is on this phone, what cloud AI sends, which apps Steadily
 * reads, and "Delete all my data". Counts only: no transaction contents are shown here.
 */
export function PrivacyScreen({ os = Platform.OS }: { os?: string }) {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const { data: summary } = useData((s) => s.getPrivacySummary?.() ?? Promise.resolve(null));
  const { data: settings } = useData((s) => s.getSettings());

  const [deleteState, setDeleteState] = useState<DeleteState>('idle');
  const [typed, setTyped] = useState('');
  const deleteAll = source.deleteAllData;
  const confirmed = typed.trim().toUpperCase() === DELETE_CONFIRM_WORD;

  const runDelete = () => {
    if (!deleteAll || !confirmed) return;
    setDeleteState('deleting');
    deleteAll().then(
      // On success the app starts over at onboarding; this screen goes away with it.
      () => setDeleteState('idle'),
      () => setDeleteState('failed'),
    );
  };

  const cancelDelete = () => {
    setTyped('');
    setDeleteState('idle');
  };

  const bankApps = listenedBankApps();

  return (
    <Screen withTabBar={false}>
      <ScreenHeader title="Privacy & data" onBack={() => router.back()} />

      <SectionLabel>On this phone</SectionLabel>
      <Card strong>
        <View style={styles.cardTop}>
          <OnDeviceBadge />
          <AppText variant="body" color={colors.ink2}>
            {summary?.encryptedAtRest === false
              ? 'Demo data, held in memory only and never written to storage.'
              : 'Stored in an encrypted database. Its key stays in this phone’s secure keystore and never leaves it.'}
          </AppText>
        </View>
        {summary === null ? null : (
          <>
            <CountRow label="Transactions" count={summary?.transactions} />
            <CountRow label="Budgets" count={summary?.budgets} />
            <CountRow label="Subscriptions" count={summary?.subscriptions} />
            <CountRow label="Merchant rules you taught it" count={summary?.rules} />
          </>
        )}
      </Card>
      <Card>
        <View style={styles.paragraphs}>
          <AppText variant="body">
            Reading alerts makes no network calls. Notifications, shared text and screenshots are
            read on this phone, and only the fields Steadily needs are kept.
          </AppText>
          <AppText variant="body" color={colors.ink2}>
            No ads, analytics or crash-reporting tools are built in. Open any transaction to see
            exactly what was kept and what wasn’t.
          </AppText>
        </View>
      </Card>

      <SectionLabel>Cloud AI</SectionLabel>
      <Card>
        <View style={styles.paragraphs}>
          {settings ? (
            <>
              <StatusPill
                label={settings.cloudAiOptIn ? 'On' : 'Off'}
                tone={settings.cloudAiOptIn ? 'accent' : 'neutral'}
                icon={settings.cloudAiOptIn ? 'check' : undefined}
              />
              <AppText variant="body" color={colors.ink2}>
                {settings.cloudAiOptIn
                  ? 'You turned it on. You can turn it off in Settings at any time.'
                  : 'Off. Nothing is sent to cloud AI: everything is worked out on this phone. You can change this in Settings.'}
              </AppText>
            </>
          ) : null}
          <AppText variant="caption" color={colors.ink2}>
            {CLOUD_SENT_SUMMARY}
          </AppText>
          <AppText variant="caption" color={colors.ink2}>
            {CLOUD_NEVER_SENT}
          </AppText>
        </View>
      </Card>

      <SectionLabel>Apps Steadily reads</SectionLabel>
      <Card>
        {os === 'android' ? (
          <View style={styles.paragraphs}>
            <AppText variant="body" color={colors.ink2}>
              With notification access, Steadily looks only at notifications from these apps.
              Notifications from every other app are ignored without being read.
            </AppText>
            <View accessibilityRole="list" accessibilityLabel="Bank and payment apps">
              {bankApps.map((app) => (
                <View
                  key={app.name}
                  style={[styles.appRow, { borderTopColor: colors.hairline }]}
                  accessible
                  accessibilityLabel={
                    app.alsoReads.length > 0
                      ? `${app.name}, including ${app.alsoReads.join(', ')} alerts`
                      : app.name
                  }
                >
                  <AppText variant="bodyStrong">{app.name}</AppText>
                  {app.alsoReads.length > 0 ? (
                    <AppText variant="caption" color={colors.ink2}>
                      Including {app.alsoReads.join(', ')} alerts in this app
                    </AppText>
                  ) : null}
                </View>
              ))}
            </View>
            <AppText variant="body" color={colors.ink2}>
              Text messages in {textMessageAppNames().join(', ')} are checked for bank alerts.
              Anything that isn’t one is dropped right away.
            </AppText>
          </View>
        ) : (
          <View style={styles.paragraphs}>
            <AppText variant="body" color={colors.ink2}>
              On iPhone, Steadily can’t see other apps’ notifications or your messages. It reads
              only the bank texts your Shortcut passes to it and what you share with it.
            </AppText>
          </View>
        )}
      </Card>

      {deleteAll ? (
        <>
          <SectionLabel>Delete all my data</SectionLabel>
          <Card>
            <View style={styles.paragraphs}>
              <AppText variant="body" color={colors.ink2}>
                Deletes every transaction, budget, subscription, rule and setting on this phone,
                along with the encryption key and any alerts waiting to be logged. This can’t be
                undone. Steadily then starts over with setup.
              </AppText>
              {deleteState === 'idle' ? (
                <Button
                  label="Delete all my data"
                  variant="neutralTint"
                  onPress={() => setDeleteState('confirming')}
                  accessibilityHint="Asks you to confirm before anything is deleted"
                />
              ) : (
                <>
                  <AppText variant="bodyStrong" color={colors.headsUp.text}>
                    To confirm, type {DELETE_CONFIRM_WORD} below.
                  </AppText>
                  <Glass
                    variant="light"
                    radius={radius.row}
                    shadow={false}
                    contentStyle={styles.inputBox}
                  >
                    <TextInput
                      value={typed}
                      onChangeText={setTyped}
                      editable={deleteState !== 'deleting'}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      placeholder={DELETE_CONFIRM_WORD}
                      placeholderTextColor={colors.ink2}
                      accessibilityLabel={`Type ${DELETE_CONFIRM_WORD} to confirm`}
                      style={[type.body, styles.input, { color: colors.ink }]}
                    />
                  </Glass>
                  {deleteState === 'failed' ? (
                    <AppText
                      variant="caption"
                      color={colors.headsUp.text}
                      accessibilityLiveRegion="polite"
                      accessibilityRole="alert"
                    >
                      Not everything could be deleted. Your data is still here. Try again.
                    </AppText>
                  ) : null}
                  <Button
                    label={deleteState === 'deleting' ? 'Deleting…' : 'Delete everything'}
                    variant="primary"
                    disabled={!confirmed || deleteState === 'deleting'}
                    onPress={runDelete}
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    disabled={deleteState === 'deleting'}
                    onPress={cancelDelete}
                  />
                </>
              )}
            </View>
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { paddingHorizontal: layout.cardPadding, paddingVertical: space.md },
  cardTop: { gap: space.sm, paddingBottom: space.sm },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: layout.touchTarget,
    paddingVertical: layout.rowPaddingVertical,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  paragraphs: { gap: space.md, paddingVertical: space.xs },
  appRow: {
    gap: space.xxs,
    paddingVertical: layout.rowPaddingVertical,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  inputBox: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  input: { minHeight: layout.touchTarget },
});
