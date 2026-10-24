import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  EmptyState,
  Glass,
  Icon,
  IconButton,
  ListCard,
  ListRow,
  OnDeviceBadge,
  ProgressSteps,
  Screen,
  StatusPill,
  Touchable,
  type IconName,
} from '@/components';
import { openBatterySettings, openNotificationAccessSettings } from '@/capture';
import { guideFor, issuerGuides } from '@/content/issuerGuides';
import { useCaptureConfirmations } from '@/hooks/useCaptureConfirmations';
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
import type { IssuerHealth, IssuerSetup, OnboardingStep } from '@/data/types';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

type OnboardingPlatform = 'ios' | 'android';

/** Steps in order. Android adds the battery explainer after notification access. */
export function onboardingSteps(platform: OnboardingPlatform): OnboardingStep[] {
  return platform === 'android'
    ? ['welcome', 'issuers', 'setup', 'connect', 'battery', 'waiting']
    : ['welcome', 'issuers', 'setup', 'connect', 'waiting'];
}

function StepCard({ children, hero = false }: { children: ReactNode; hero?: boolean }) {
  return <Card tier={hero ? 'hero' : 'standard'}>{children}</Card>;
}

/** Every step opens the same way: optional eyebrow, title, one paragraph. */
function Intro({ eyebrow, title, body }: { eyebrow?: string; title: string; body?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.intro}>
      {eyebrow ? (
        <AppText variant="captionStrong" color={colors.ink2}>
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color={colors.ink2}>
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

/** Every step closes the same way: one primary action, an optional quieter one under it. */
function Actions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

/** Text-only link that sits flush with the screen edge; the hit area grows past it to 44 pt. */
function EdgeLink({
  label,
  onPress,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      hitSlop={EDGE_LINK_HIT_SLOP}
      style={styles.edgeLink}
    >
      <AppText variant="bodyStrong" color={colors.accentInk}>
        {label}
      </AppText>
    </Touchable>
  );
}

/** At large text sizes the status pill moves under the name. */
const STACK_PILL_FONT_SCALE = 1.3;

const EDGE_LINK_HIT_SLOP = { top: 8, bottom: 8, left: 12, right: 12 };

const HEALTH_PILL: Record<
  IssuerHealth,
  { tone: 'onTrack' | 'headsUp' | 'neutral'; icon?: IconName }
> = {
  receiving: { tone: 'onTrack', icon: 'check' },
  quiet: { tone: 'headsUp', icon: 'bell' },
  waiting: { tone: 'neutral' },
  not_set_up: { tone: 'neutral' },
};

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
    <Touchable
      onPress={onPress}
      feedback="scale"
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected }}
      style={styles.tileWrap}
    >
      <Glass
        variant="light"
        radius={radius.row}
        elevation="none"
        fixed
        contentStyle={[
          styles.tile,
          selected
            ? { borderColor: colors.accent, backgroundColor: colors.accentTint }
            : { borderColor: colors.solidBorder },
        ]}
      >
        <AppText variant="bodyStrong" style={styles.flex}>
          {name}
        </AppText>
        <View
          style={[
            styles.tileCheck,
            selected
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { borderColor: colors.solidBorder },
          ]}
        >
          {selected ? (
            <Icon name="check" size={iconSize.badge} color={colors.onAccent} strokeWidth={2.4} />
          ) : null}
        </View>
      </Glass>
    </Touchable>
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
  const { fontScale } = useWindowDimensions();
  const now = useNow();
  const { data: progress } = useData((s) => s.getOnboarding());
  const { data: setups } = useData((s) => s.listIssuerSetup());
  const confirmations = useCaptureConfirmations();

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
          <Intro
            title="Welcome to Steadily"
            body="Know what's safe to spend, from the alerts your bank already sends."
          />
          <StepCard hero>
            <OnDeviceBadge />
            <AppText variant="heading">No bank login. Alerts are read on your phone.</AppText>
            <Bullet icon="lock" text="We never ask for card numbers or passwords." />
            <Bullet icon="phone" text="Alert text is read here, then deleted right away." />
            <Bullet icon="check" text="Works offline. Your spending stays on this phone." />
          </StepCard>
          <Actions>
            <Button label="Get started" onPress={next} />
          </Actions>
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
          <Intro
            title="Which banks and cards do you use?"
            body="Pick all that apply. This list stays on your phone."
          />
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
          <Actions>
            {picked.size > 0 ? (
              <Button label={`Continue with ${picked.size}`} onPress={() => void confirm()} />
            ) : (
              <Button label="Skip for now" variant="link" onPress={() => void confirm()} />
            )}
          </Actions>
        </>
      );
      break;
    }

    case 'setup': {
      const current: IssuerSetup | undefined = pending[0];
      if (!current) {
        content = (
          <EmptyState
            tier="hero"
            icon="check"
            tone="onTrack"
            title={selected.length > 0 ? 'Cards are set' : 'No cards picked'}
            body={
              selected.length > 0
                ? 'You went through every card. You can revisit any of them from Settings.'
                : 'You can add banks and cards later from Settings.'
            }
            action={{ label: 'Continue', onPress: next }}
          />
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
          <Intro
            eyebrow={`Card ${position} of ${selected.length}`}
            title={`Turn on ${name} alerts`}
            body={
              guide.kind === 'p2p'
                ? 'Payment notifications let Steadily log what you send and receive.'
                : 'An alert for every purchase lets Steadily log spending as it happens.'
            }
          />
          <StepCard>
            <NumberedSteps steps={guide.steps} />
            {issuerGuides.verified ? null : (
              <StatusPill
                label="General steps. Menu names in your app may differ."
                tone="neutral"
              />
            )}
          </StepCard>
          <Actions>
            <Button label="I've done it" onPress={() => mark('done')} />
            <Button label="Skip" variant="link" onPress={() => mark('skipped')} />
          </Actions>
        </>
      );
      break;
    }

    case 'connect':
      content =
        os === 'android' ? (
          <>
            <Intro
              title="Let Steadily see bank notifications"
              body="With notification access, Steadily reads alerts from the bank and payment apps you picked. Everything else is ignored right away."
            />
            <StepCard>
              <Bullet icon="bell" text="Only purchase alerts are kept, as amount and merchant." />
              <Bullet icon="lock" text="Nothing is sent anywhere. It all happens on this phone." />
              <Bullet icon="check" text="Text message alerts work too. No SMS permission needed." />
            </StepCard>
            {/* Android 13+ asks before any notification shows, including the confirmation. */}
            {confirmations.needsPermission ? (
              <StepCard>
                <AppText variant="heading">See each purchase land</AppText>
                <AppText variant="body" color={colors.ink2}>
                  After each alert, Steadily shows a quiet note like "Logged $12.40 at Corner Cafe"
                  so you know it worked. It is made on this phone and you can turn it off in
                  Settings.
                </AppText>
                {confirmations.canPost ? (
                  <StatusPill label="Notifications allowed" tone="onTrack" icon="check" />
                ) : (
                  <Button
                    label={confirmations.blocked ? 'Open app settings' : 'Allow notifications'}
                    variant="accentTint"
                    onPress={() => void confirmations.allow()}
                  />
                )}
              </StepCard>
            ) : null}
            <Actions>
              <Button
                label="Open notification access"
                onPress={() => void openNotificationAccessSettings()}
              />
              <Button label="Continue" variant="link" onPress={next} />
            </Actions>
          </>
        ) : (
          <>
            <Intro
              title="Connect your text alerts"
              body="One Shortcuts automation sends bank texts to Steadily. They are read on this phone and anything that isn't a purchase is thrown away."
            />
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
            <Actions>
              <Button label="I've set it up" onPress={next} />
              <Button label="Skip" variant="link" onPress={next} />
            </Actions>
          </>
        );
      break;

    case 'battery':
      content = (
        <>
          <Intro
            title="Keep Steadily ready"
            body="Some phones pause apps to save battery, and alerts get missed. Letting Steadily run unrestricted keeps capture reliable. It uses very little power."
          />
          <StepCard>
            <Bullet icon="battery" text="Find Steadily under Battery and choose Unrestricted." />
            <Bullet icon="check" text="You can change this later in your phone's settings." />
          </StepCard>
          <Actions>
            <Button label="Open battery settings" onPress={() => void openBatterySettings()} />
            <Button label="Continue" variant="link" onPress={next} />
          </Actions>
        </>
      );
      break;

    case 'waiting': {
      const stackPill = fontScale >= STACK_PILL_FONT_SCALE;
      content = (
        <>
          <Intro
            title="Waiting for your first alert"
            body="Use a card you set up, or wait for your next purchase. It will show up in Steadily on its own."
          />
          {selected.length === 0 ? (
            <StepCard>
              <AppText variant="body" color={colors.ink2}>
                No banks or cards picked yet. You can add them from Settings.
              </AppText>
            </StepCard>
          ) : (
            <ListCard>
              {selected.map((s) => {
                const health = issuerHealth(s, now);
                const issuer = issuerName(s.issuerId) ?? s.issuerId;
                const pill = (
                  <StatusPill label={ISSUER_HEALTH_LABEL[health]} {...HEALTH_PILL[health]} />
                );
                return (
                  <ListRow
                    key={s.issuerId}
                    title={issuer}
                    trailing={stackPill ? undefined : pill}
                    accessibilityLabel={`${issuer}: ${ISSUER_HEALTH_LABEL[health]}`}
                  >
                    {stackPill ? pill : null}
                  </ListRow>
                );
              })}
            </ListCard>
          )}
          <Actions>
            <Button label="Go to Home" onPress={finish} />
          </Actions>
        </>
      );
      break;
    }
  }

  return (
    <Screen withTabBar={false} readable>
      <View style={styles.top}>
        <View style={styles.topRow}>
          {index > 0 ? (
            <IconButton icon="chevronLeft" accessibilityLabel="Back" onPress={back} />
          ) : null}
          <View style={styles.flex} />
          {step !== 'waiting' ? (
            <EdgeLink
              label="Set up later"
              onPress={finish}
              accessibilityHint="Skips setup for now. You can continue from Settings."
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
  top: { gap: space.md },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
  },
  edgeLink: { minHeight: 28, justifyContent: 'center' },
  intro: { gap: space.sm, marginTop: space.sm },
  actions: { gap: space.xs, marginTop: space.xs },
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
    minHeight: layout.rowMinHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderWidth: 2,
  },
  tileCheck: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
