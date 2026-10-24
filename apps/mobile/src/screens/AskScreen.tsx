import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AppText,
  Button,
  EmptyState,
  EntranceView,
  Glass,
  Icon,
  OnDeviceBadge,
  ScreenBackground,
  ScreenHeader,
  SectionLabel,
  StatusPill,
  Touchable,
  useTabBarClearance,
} from '@/components';
import { useDataSource } from '@/data';
import type { AskTurn } from '@/data/types';
import { spokenText } from '@/lib/money';
import { iconSize, layout, radius, space, type, useTheme } from '@/theme';

/** Starter questions the rules answerer understands. */
export const ASK_SUGGESTIONS: readonly string[] = [
  'How much did I spend this month?',
  'Top merchants last month',
  'Am I on budget?',
  'Compare this month to last month',
  'What subscriptions are coming up?',
];

const MAX_QUESTION_CHARS = 500;

type Entry = {
  key: number;
  question: string;
  state: 'loading' | 'done' | 'error';
  turn?: AskTurn;
};

function announce(message: string) {
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // Not available on this platform: the live region on the card still covers it.
  }
}

function SourceLabel({ answeredBy }: { answeredBy: AskTurn['answeredBy'] }) {
  if (answeredBy === 'cloud_llm') {
    return <StatusPill label="Answered with cloud AI" tone="headsUp" />;
  }
  return <OnDeviceBadge />;
}

function QuestionBubble({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.questionRow}>
      <View
        style={[styles.question, { backgroundColor: colors.accentTint }]}
        accessible
        accessibilityLabel={`You asked: ${text}`}
      >
        <AppText variant="bodyStrong" color={colors.accentInk}>
          {text}
        </AppText>
      </View>
    </View>
  );
}

function AnswerCard({ entry, onRetry }: { entry: Entry; onRetry: () => void }) {
  const { colors } = useTheme();

  if (entry.state === 'loading') {
    return (
      <Glass
        variant="strong"
        elevation="soft"
        radius={radius.cardSmall}
        contentStyle={styles.answer}
      >
        <View
          style={styles.loading}
          accessible
          accessibilityLabel="Working on your answer"
          accessibilityState={{ busy: true }}
          accessibilityLiveRegion="polite"
        >
          <ActivityIndicator color={colors.accent} />
          <AppText variant="body" color={colors.ink2}>
            Working it out…
          </AppText>
        </View>
      </Glass>
    );
  }

  if (entry.state === 'error' || !entry.turn) {
    return (
      <Glass
        variant="strong"
        elevation="soft"
        radius={radius.cardSmall}
        contentStyle={styles.answer}
      >
        <View accessible accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <AppText variant="heading">That did not work</AppText>
          <AppText variant="body" color={colors.ink2}>
            Steadily could not answer this one. Nothing was sent anywhere. Try again.
          </AppText>
        </View>
        <Button label="Try again" variant="accentTint" onPress={onRetry} />
      </Glass>
    );
  }

  const { turn } = entry;
  return (
    <EntranceView>
      <Glass
        variant="strong"
        elevation="soft"
        radius={radius.cardSmall}
        contentStyle={styles.answer}
      >
        <AppText
          variant="body"
          accessibilityLabel={spokenText(turn.text)}
          accessibilityLiveRegion="polite"
          selectable
        >
          {turn.text}
        </AppText>
        <SourceLabel answeredBy={turn.answeredBy} />
      </Glass>
    </EntranceView>
  );
}

/** First view of Ask: what it does, where answers come from, and questions to start with. */
function AskIntro({
  available,
  onPick,
}: {
  available: boolean;
  onPick: (question: string) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.intro}>
      <EmptyState
        tier="hero"
        icon="ask"
        title="Ask about your money"
        body={
          available
            ? 'Your questions are answered on this phone, from the transactions you have saved here. Nothing leaves your phone unless you turn on cloud AI in Settings.'
            : 'Asking is not available in this build yet.'
        }
      >
        {available ? (
          <View style={styles.badgeWrap}>
            <OnDeviceBadge />
          </View>
        ) : null}
      </EmptyState>
      {available ? (
        <>
          <SectionLabel>Try asking</SectionLabel>
          <View style={styles.chips} accessibilityLabel="Suggested questions">
            {ASK_SUGGESTIONS.map((suggestion) => (
              <Touchable
                key={suggestion}
                onPress={() => onPick(suggestion)}
                feedback="scale"
                accessibilityRole="button"
                accessibilityLabel={suggestion}
                accessibilityHint="Asks this question"
              >
                <Glass
                  variant="light"
                  radius={radius.pill}
                  elevation="none"
                  fixed
                  contentStyle={styles.chip}
                >
                  <Icon name="ask" size={iconSize.sm} color={colors.accentInk} />
                  <AppText variant="bodyStrong" color={colors.accentInk} style={styles.chipText}>
                    {suggestion}
                  </AppText>
                </Glass>
              </Touchable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

export function AskScreen() {
  const source = useDataSource();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const available = typeof source.ask === 'function';

  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [keyboardUp, setKeyboardUp] = useState(false);
  const nextKey = useRef(1);
  const mounted = useRef(true);
  const scroll = useRef<{ scrollToEnd: (options?: { animated?: boolean }) => void } | null>(null);
  const busy = entries.some((e) => e.state === 'loading');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const patch = useCallback((key: number, change: Partial<Entry>) => {
    // Cleared entries are gone: a late answer for them is dropped.
    setEntries((all) => all.map((e) => (e.key === key ? { ...e, ...change } : e)));
  }, []);

  const run = useCallback(
    async (key: number, question: string) => {
      const ask = source.ask;
      if (!ask) {
        patch(key, { state: 'error' });
        return;
      }
      patch(key, { state: 'loading' });
      try {
        const turn = await ask(question);
        if (!mounted.current) return;
        patch(key, { state: 'done', turn });
        announce(spokenText(turn.text));
      } catch {
        // The error is not logged: it could echo question text.
        if (!mounted.current) return;
        patch(key, { state: 'error' });
        announce('Could not answer that question');
      }
    },
    [source, patch],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim().slice(0, MAX_QUESTION_CHARS);
      if (!question || busy || !available) return;
      const key = nextKey.current++;
      setEntries((all) => [...all, { key, question, state: 'loading' }]);
      setDraft('');
      void run(key, question);
    },
    [busy, available, run],
  );

  const canSend = available && !busy && draft.trim() !== '';

  return (
    <ScreenBackground>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={(node) => {
            scroll.current = node;
          }}
          style={styles.flex}
          contentContainerStyle={[
            styles.list,
            {
              paddingTop: insets.top + space.md,
              paddingLeft: insets.left + layout.screenPadding,
              paddingRight: insets.right + layout.screenPadding,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          <ScreenHeader
            eyebrow="Answers come from this phone"
            title="Ask"
            right={
              entries.length > 0 ? (
                <Button
                  label="Clear"
                  variant="link"
                  accessibilityHint="Removes this conversation from the screen"
                  onPress={() => setEntries([])}
                />
              ) : undefined
            }
          />
          {entries.length === 0 ? (
            <AskIntro available={available} onPick={send} />
          ) : (
            entries.map((entry) => (
              <View key={entry.key} style={styles.turn}>
                <QuestionBubble text={entry.question} />
                <AnswerCard entry={entry} onRetry={() => void run(entry.key, entry.question)} />
              </View>
            ))
          )}
        </ScrollView>

        <View
          style={[
            styles.inputBar,
            {
              paddingLeft: insets.left + layout.screenPadding,
              paddingRight: insets.right + layout.screenPadding,
              paddingBottom: keyboardUp ? space.sm : clearance,
            },
          ]}
        >
          <Glass
            variant="strong"
            radius={radius.pill}
            fixed
            style={styles.flex}
            contentStyle={styles.inputBox}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask about your spending"
              placeholderTextColor={colors.ink2}
              accessibilityLabel="Your question"
              editable={available}
              maxLength={MAX_QUESTION_CHARS}
              returnKeyType="send"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => send(draft)}
              style={[type.body, styles.input, { color: colors.ink }]}
            />
          </Glass>
          <Touchable
            onPress={() => send(draft)}
            disabled={!canSend}
            feedback="scale"
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !canSend, busy }}
            hitSlop={SEND_HIT_SLOP}
            style={[
              styles.send,
              canSend
                ? { backgroundColor: colors.accent }
                : { backgroundColor: colors.neutralTint, borderColor: colors.hairline },
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.ink2} />
            ) : (
              <Icon
                name="arrowUp"
                size={iconSize.md}
                color={canSend ? colors.onAccent : colors.ink2}
              />
            )}
          </Touchable>
        </View>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

/** The send button is 44 pt; this lifts its hit area to the 48 dp Android minimum. */
const SEND_HIT_SLOP = { top: 2, bottom: 2, left: 2, right: 2 };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { gap: layout.cardGap, paddingBottom: space.lg },
  turn: { gap: space.sm },
  questionRow: { alignItems: 'flex-end' },
  question: {
    maxWidth: '88%',
    borderRadius: radius.row,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  answer: { padding: layout.cardPadding, gap: space.md },
  loading: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  intro: { gap: layout.cardGap },
  badgeWrap: { alignItems: 'center' },
  chips: { gap: space.sm, alignItems: 'flex-start' },
  chip: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  chipText: { flexShrink: 1 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.sm,
  },
  inputBox: { minHeight: layout.touchTarget + space.xs, justifyContent: 'center' },
  input: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  send: {
    width: layout.touchTarget,
    height: layout.touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'transparent',
  },
});
