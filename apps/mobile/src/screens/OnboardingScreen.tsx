import { useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Glass,
  Icon,
  OnDeviceBadge,
  ProgressSteps,
  Screen,
  StatusPill,
} from '@/components';
import type { IconName } from '@/components/Icon';
import { openBatterySettings, openNotificationAccessSettings } from '@/capture';
import { guideFor, issuerGuides } from '@/content/issuerGuides';
import {
  ISSUER_HEALTH_LABEL,
  ISSUERS,
  issuerHealth,
  issuerName,
  useData,
  useDataSource,
  useNow,
  type IssuerId,
} from '@/data';
import type { IssuerSetup, OnboardingStep } from '@/data/types';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

type OnboardingPlatform = 'ios' | 'android';

/** Steps in order. Android adds the battery explainer after notification access. */
export function onboardingSteps(platform: OnboardingPlatform): OnboardingStep[] {
  return platform === 'android'
    ? ['welcome', 'issuers', 'setup', 'connect', 'battery', 'waiting']
    : ['welcome', 'issuers', 'setup', 'connect', 'waiting'];
}

function StepCard({ children }: { children: ReactNode }) {
  return (
    <Glass variant="strong" radius={radius.card} contentStyle={styles.card}>
      {children}
    </Glass>
  );
}

function Bullet({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.bullet}>
      <View style={[styles.bulletIcon, { backgroundColor: colors.onDevice.bg }]}>
        <Icon name={icon} size={iconSize.sm} color={colors.onDevice.text} />
      </View>
      <AppText variant="body" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

function NumberedSteps({ steps }: { steps: readonly string[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.steps}>
      {steps.map((step, i) => (
        <View key={i} style={styles.bullet} accessible accessibilityLabel={`${i + 1}. ${step}`}>
          <View style={[styles.stepNumber, { backgroundColor: colors.accentTint }]}>
            <AppText variant="captionStrong" color={colors.accentInk}>
              {i + 1}
            </AppText>
          </View>
          <AppText variant="body" style={styles.flex}>
            {step}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function IssuerTile({
  name,
  selected,
  onPress,
}: {
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected }}
      style={({ pressed }) => [styles.tileWrap, pressed && styles.pressed]}
    >
      <Glass
        variant="light"
        radius={radius.row}
        shadow={false}
        fixed
        contentStyle={[styles.tile, { borderColor: selected ? colors.accent : colors.solidBorder }]}
      >
        <AppText variant="bodyStrong" style={styles.flex}>
          {name}
        </AppText>
        {selected ? <Icon name="check" size={iconSize.md} color={colors.accent} /> : null}
      </Glass>
    </Pressable>
  );
}

type OnboardingScreenProps = {
  /** Defaults to the running platform; tests pass one explicitly. */
  platform?: OnboardingPlatform;
};

/**
 * First-run setup (D-014): privacy promise, pick issuers, per-issuer alert guides, connect
 * Steadily (iOS Shortcut / Android notification access + battery), then wait for the first
 * alert. Every step can be skipped; progress is saved in the data layer so it resumes.
 */
export function OnboardingScreen({ platform }: OnboardingScreenProps) {
  const os: OnboardingPlatform = platform ?? (Platform.OS === 'android' ? 'android' : 'ios');
  const source = useDataSource();
  const { colors } = useTheme();
  const now = useNow();
  const { data: progress } = useData((s) => s.getOnboarding());
  const { data: setups } = useData((s) => s.listIssuerSetup());

  const [picked, setPicked] = useState<Set<IssuerId> | null>(null);
  useEffect(() => {
    if (setups && picked === null) {
      setPicked(new Set(setups.filter((s) => s.selected).map((s) => s.issuerId)));
    }
  }, [setups, picked]);

  if (!progress || !setups || picked === null) return <Screen withTabBar={false}>{null}</Screen>;

  const steps = onboardingSteps(os);
  // A step saved on the other platform (e.g. "battery") falls back to the next shared one.
  const step = steps.includes(progress.step) ? progress.step : 'waiting';
  const index = steps.indexOf(step);

  const go = (next: OnboardingStep) => void source.saveOnboarding({ step: next });
  const next = () => go(steps[Math.min(index + 1, steps.length - 1)] ?? 'waiting');
  const back = () => go(steps[Math.max(index - 1, 0)] ?? 'welcome');
  const finish = () => void source.saveOnboarding({ completed: true });

  const selected = setups.filter((s) => s.selected);
  const pending = selected.filter((s) => s.setupStatus === 'pending');

  let content: ReactNode;
  switch (step) {
    case 'welcome':
      content = (
        <>
          <View style={styles.intro}>
            <AppText variant="title" accessibilityRole="header">
              Welcome to Steadily
            </AppText>
            <AppText variant="body" color={colors.ink2}>
              Know what's safe to spend, from the alerts your bank already sends.
            </AppText>
          </View>
          <StepCard>
            <OnDeviceBadge />
            <AppText variant="heading">No bank login. Alerts are read on your phone.</AppText>
            <Bullet icon="lock" text="We never ask for card numbers or passwords." />
            <Bullet icon="phone" text="Alert text is read here, then deleted right away." />
            <Bullet icon="check" text="Works offline. Your spending stays on this phone." />
          </StepCard>
          <Button label="Get started" onPress={next} />
        </>
      );
      break;

    case 'issuers': {
      const toggle = (id: IssuerId) => {
        const nextSet = new Set(picked);
        if (nextSet.has(id)) nextSet.delete(id);
        else nextSet.add(id);
        setPicked(nextSet);
      };
      const confirm = async () => {
        await source.setSelectedIssuers([...picked]);
        await source.saveOnboarding({ step: picked.size > 0 ? 'setup' : 'connect' });
      };
      content = (
        <>
          <View style={styles.intro}>
            <AppText variant="title" accessibilityRole="header">
              Which banks and cards do you use?
            </AppText>
            <AppText variant="body" color={colors.ink2}>
              Pick all that apply. This list stays on your phone.
            </AppText>
          </View>
          <View style={styles.grid}>
            {ISSUERS.map((issuer) => (
              <IssuerTile
                key={issuer.id}
                name={issuer.name}
                selected={picked.has(issuer.id)}
                onPress={() => toggle(issuer.id)}
              />
            ))}
          </View>
          <Button
            label={picked.size > 0 ? `Continue with ${picked.size}` : 'Skip for now'}
            variant={picked.size > 0 ? 'primary' : 'secondary'}
            onPress={() => void confirm()}
          />
        </>
      );
      break;
    }

    case 'setup': {
      const current: IssuerSetup | undefined = pending[0];
      if (!current) {
        content = (
          <>
            <StepCard>
              <AppText variant="heading" accessibilityRole="header">
                {selected.length > 0 ? 'Cards are set' : 'No cards picked'}
              </AppText>
              <AppText variant="body" color={colors.ink2}>
                {selected.length > 0
                  ? 'You went through every card. You can revisit any of them from Settings.'
                  : 'You can add banks and cards later from Settings.'}
              </AppText>
            </StepCard>
            <Button label="Continue" onPress={next} />
          </>
        );
        break;
      }
      const name = issuerName(current.issuerId) ?? 'Your bank';
      const guide = guideFor(current.issuerId);
      const position = selected.findIndex((s) => s.issuerId === current.issuerId) + 1;
      const mark = (status: 'done' | 'skipped') =>
        void source.setIssuerSetupStatus(current.issuerId, status);
      content = (
        <>
          <View style={styles.intro}>
            <AppText variant="caption" color={colors.ink2}>
              Card {position} of {selected.length}
            </AppText>
            <AppText variant="title" accessibilityRole="header">
              Turn on {name} alerts
            </AppText>
            <AppText variant="body" color={colors.ink2}>
              {guide.kind === 'p2p'
                ? 'Payment notifications let Steadily log what you send and receive.'
                : 'An alert for every purchase lets Steadily log spending as it happens.'}
            </AppText>
          </View>
          <StepCard>
            <NumberedSteps steps={guide.steps} />
            {issuerGuides.verified ? null : (
              <StatusPill
                label="General steps. Menu names in your app may differ."
                tone="neutral"
              />
            )}
          </StepCard>
          <Button label="I've done it" onPress={() => mark('done')} />
          <Button label="Skip" variant="secondary" onPress={() => mark('skipped')} />
        </>
      );
      break;
    }

    case 'connect':
      content =
        os === 'android' ? (
          <>
            <View style={styles.intro}>
              <AppText variant="title" accessibilityRole="header">
                Let Steadily see bank notifications
              </AppText>
              <AppText variant="body" color={colors.ink2}>
                With notification access, Steadily reads alerts from the bank and payment apps you
                picked. Everything else is ignored right away.
              </AppText>
            </View>
            <StepCard>
              <Bullet icon="bell" text="Only purchase alerts are kept, as amount and merchant." />
              <Bullet icon="lock" text="Nothing is sent anywhere. It all happens on this phone." />
              <Bullet icon="check" text="Text message alerts work too. No SMS permission needed." />
            </StepCard>
            <Button
              label="Open notification access"
              onPress={() => void openNotificationAccessSettings()}
            />
            <Button label="Continue" variant="secondary" onPress={next} />
          </>
        ) : (
          <>
            <View style={styles.intro}>
              <AppText variant="title" accessibilityRole="header">
                Connect your text alerts
              </AppText>
              <AppText variant="body" color={colors.ink2}>
                One Shortcuts automation sends bank texts to Steadily. They are read on this phone
                and anything that isn't a purchase is thrown away.
              </AppText>
            </View>
            <StepCard>
              {/* TODO: replace with the verified Shortcuts steps and a shared Shortcut link. */}
              <NumberedSteps
                steps={[
                  'Open the Shortcuts app and go to Automation.',
                  'Create a Message automation for texts that contain "$".',
                  'Add the Steadily "Log alert" action and set it to run immediately.',
                ]}
              />
              <StatusPill label="General steps. Exact names may differ." tone="neutral" />
            </StepCard>
            <Button label="I've set it up" onPress={next} />
            <Button label="Skip" variant="secondary" onPress={next} />
          </>
        );
      break;

    case 'battery':
      content = (
        <>
          <View style={styles.intro}>
            <AppText variant="title" accessibilityRole="header">
              Keep Steadily ready
            </AppText>
            <AppText variant="body" color={colors.ink2}>
              Some phones pause apps to save battery, and alerts get missed. Letting Steadily run
              unrestricted keeps capture reliable. It uses very little power.
            </AppText>
          </View>
          <StepCard>
            <Bullet icon="battery" text="Find Steadily under Battery and choose Unrestricted." />
            <Bullet icon="check" text="You can change this later in your phone's settings." />
          </StepCard>
          <Button label="Open battery settings" onPress={() => void openBatterySettings()} />
          <Button label="Continue" variant="secondary" onPress={next} />
        </>
      );
      break;

    case 'waiting':
      content = (
        <>
          <View style={styles.intro}>
            <AppText variant="title" accessibilityRole="header">
              Waiting for your first alert
            </AppText>
            <AppText variant="body" color={colors.ink2}>
              Use a card you set up, or wait for your next purchase. It will show up in Steadily on
              its own.
            </AppText>
          </View>
          <StepCard>
            {selected.length === 0 ? (
              <AppText variant="body" color={colors.ink2}>
                No banks or cards picked yet. You can add them from Settings.
              </AppText>
            ) : (
              selected.map((s, i) => {
                const health = issuerHealth(s, now);
                return (
                  <View
                    key={s.issuerId}
                    style={[
                      styles.statusRow,
                      i > 0 && [styles.divider, { borderTopColor: colors.hairline }],
                    ]}
                    accessible
                    accessibilityLabel={`${issuerName(s.issuerId)}: ${ISSUER_HEALTH_LABEL[health]}`}
                  >
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {issuerName(s.issuerId)}
                    </AppText>
                    <StatusPill
                      label={ISSUER_HEALTH_LABEL[health]}
                      tone={health === 'receiving' ? 'onTrack' : 'neutral'}
                      icon={health === 'receiving' ? 'check' : undefined}
                    />
                  </View>
                );
              })
            )}
          </StepCard>
          <Button label="Go to Home" onPress={finish} />
        </>
      );
      break;
  }

  return (
    <Screen withTabBar={false}>
      <View style={styles.top}>
        <View style={styles.topRow}>
          {index > 0 ? (
            <Button label="Back" variant="link" onPress={back} style={styles.edgeLeft} />
          ) : (
            <View />
          )}
          {step !== 'waiting' ? (
            <Button
              label="Set up later"
              variant="link"
              onPress={finish}
              accessibilityHint="Skips setup for now. You can continue from Settings."
              style={styles.edgeRight}
            />
          ) : null}
        </View>
        <ProgressSteps current={index + 1} total={steps.length} />
      </View>
      {content}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  top: { gap: space.sm },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: layout.touchTarget,
  },
  edgeLeft: { marginLeft: -space.lg },
  edgeRight: { marginRight: -space.lg },
  intro: { gap: space.sm, marginTop: space.sm },
  card: { padding: layout.cardPadding + 2, gap: space.md },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  bulletIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  steps: { gap: space.md },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tileWrap: { flexGrow: 1, flexBasis: '45%' },
  tile: {
    minHeight: layout.touchTarget + space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderWidth: 2,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
});
