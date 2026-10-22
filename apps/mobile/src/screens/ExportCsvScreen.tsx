import { buildExportCsv } from '@steadily/csv-import';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Glass, Icon, RadioRow, Screen, ScreenHeader } from '@/components';
import { useData, useDataSource, useNow } from '@/data';
import type { DateRange } from '@/data/types';
import { canShareFiles, clearExportFiles, shareCsv } from '@/lib/csvFiles';
import { dayKey } from '@/lib/dates';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

type RangeId = 'month' | 'quarter' | 'year' | 'all';

/** Every range runs to the far future, so nothing dated ahead (e.g. a pending charge) is lost. */
const FAR_FUTURE = new Date(2100, 0, 1).toISOString();

const RANGES: readonly { id: RangeId; label: string; from: (now: Date) => Date }[] = [
  {
    id: 'month',
    label: 'This month',
    from: (now) => new Date(now.getFullYear(), now.getMonth(), 1),
  },
  {
    id: 'quarter',
    label: 'Last 3 months',
    from: (now) => new Date(now.getFullYear(), now.getMonth() - 2, 1),
  },
  { id: 'year', label: 'This year', from: (now) => new Date(now.getFullYear(), 0, 1) },
  { id: 'all', label: 'Everything', from: () => new Date(1970, 0, 1) },
];

export function exportRange(id: RangeId, now: Date): DateRange {
  const range = RANGES.find((r) => r.id === id) ?? RANGES[0]!;
  return { from: range.from(now).toISOString(), to: FAR_FUTURE };
}

const LEAVES_STEADILY =
  'The exported file leaves Steadily’s protection. It is not encrypted: anyone or any app you share it with can read every transaction in it, including merchants, amounts and notes.';
const AFTERWARDS =
  'Share it only with apps and people you trust, and delete it when you no longer need it.';

/**
 * Settings → Export CSV. Builds the file on this phone from stored transactions and opens the
 * share sheet; Steadily itself sends it nowhere.
 */
export function ExportCsvScreen() {
  const router = useRouter();
  const source = useDataSource();
  const now = useNow();
  const { colors } = useTheme();
  const [rangeId, setRangeId] = useState<RangeId>('month');
  const [status, setStatus] = useState<'idle' | 'working' | 'shared' | 'failed' | 'unavailable'>(
    'idle',
  );
  const { data: transactions } = useData(
    (s) => s.listTransactions(exportRange(rangeId, now)),
    [rangeId, now],
  );

  useEffect(() => {
    // The share copy lives in the app cache only while this screen is open.
    clearExportFiles();
    return clearExportFiles;
  }, []);

  const count = transactions?.length ?? 0;

  async function exportNow() {
    setStatus('working');
    try {
      if (!(await canShareFiles())) {
        setStatus('unavailable');
        return;
      }
      const rows = await source.listTransactions(exportRange(rangeId, now));
      await shareCsv(`steadily-transactions-${dayKey(now)}.csv`, buildExportCsv(rows));
      setStatus('shared');
    } catch {
      // Not logged: the error could carry file contents.
      setStatus('failed');
    }
  }

  return (
    <Screen withTabBar={false}>
      <ScreenHeader
        title="Export CSV"
        onBack={() => router.back()}
        backIcon="close"
        backLabel="Close"
      />

      <Glass variant="light" radius={radius.cardSmall} contentStyle={styles.card}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Which transactions">
          {RANGES.map((range, i) => (
            <View
              key={range.id}
              style={i > 0 && [styles.divider, { borderTopColor: colors.hairline }]}
            >
              <RadioRow
                label={range.label}
                selected={rangeId === range.id}
                onPress={() => {
                  setRangeId(range.id);
                  setStatus('idle');
                }}
              />
            </View>
          ))}
        </View>
      </Glass>

      <View
        style={[styles.notice, { backgroundColor: colors.headsUp.bg }]}
        accessible
        accessibilityLabel={`Before you export. ${LEAVES_STEADILY} ${AFTERWARDS}`}
      >
        <View style={styles.noticeTitle}>
          <Icon name="lock" size={iconSize.md} color={colors.headsUp.text} />
          <AppText variant="heading" color={colors.headsUp.text}>
            Before you export
          </AppText>
        </View>
        <AppText variant="body" color={colors.headsUp.text}>
          {LEAVES_STEADILY}
        </AppText>
        <AppText variant="body" color={colors.headsUp.text}>
          {AFTERWARDS}
        </AppText>
      </View>

      <AppText variant="caption" color={colors.ink2}>
        Columns: date, merchant, category, amount, currency, kind, status, source and note.
      </AppText>

      <Button
        label={
          transactions === undefined
            ? 'Export CSV'
            : count === 0
              ? 'Nothing to export in this range'
              : `Export ${count.toLocaleString('en-US')} ${count === 1 ? 'transaction' : 'transactions'}`
        }
        onPress={() => void exportNow()}
        disabled={count === 0 || status === 'working'}
        accessibilityHint="Opens the share sheet with the file"
      />
      {status === 'shared' || status === 'failed' || status === 'unavailable' ? (
        <AppText
          variant="caption"
          color={status === 'shared' ? colors.ink2 : colors.headsUp.text}
          accessibilityLiveRegion="polite"
        >
          {status === 'shared'
            ? 'Done. Steadily deletes its copy of the file when you close this screen.'
            : status === 'unavailable'
              ? 'Sharing files isn’t available on this device.'
              : 'The export didn’t finish. Try again.'}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  notice: { borderRadius: radius.cardSmall, padding: layout.cardPadding, gap: space.sm },
  noticeTitle: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
