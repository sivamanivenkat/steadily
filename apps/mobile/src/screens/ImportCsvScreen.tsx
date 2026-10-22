import {
  columnLabels,
  detectFormat,
  guessMapping,
  isCompleteMapping,
  MAX_IMPORT_ROWS,
  parseCsv,
  readRows,
  type ColumnMapping,
  type CsvTable,
  type ImportPlan,
  type ImportRow,
  type ReadResult,
} from '@steadily/csv-import';
import { normalizeMerchant } from '@steadily/merchants';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Glass,
  Icon,
  OnDeviceBadge,
  RadioRow,
  Screen,
  ScreenHeader,
  SectionLabel,
} from '@/components';
import { useDataSource } from '@/data';
import type { ImportCheck, ImportResult } from '@/data/csvImport';
import { CsvFileTooLargeError, pickCsvText } from '@/lib/csvFiles';
import { formatShortDate } from '@/lib/dates';
import { formatMoney, spokenMoney } from '@/lib/money';
import { iconSize, layout, radius, space, useTheme } from '@/theme';

const SAMPLE_ROWS = 5;
const SUPPORTED =
  'Recognises exports from Chase, Bank of America, Capital One, Amex, Citi, Discover, Wells Fargo, US Bank, Apple Card, Venmo and PayPal. Other files: you pick the columns.';

type Step =
  | { kind: 'start'; error?: string }
  | { kind: 'reading' }
  | { kind: 'mapping'; mapping: ColumnMapping; labels: string[] }
  | { kind: 'preview'; planName: string; read: ReadResult; check: ImportCheck; canRemap: boolean }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'done'; result: ImportResult }
  | { kind: 'failed' };

/** "Oct 8 – Oct 14, 2026" from "YYYY-MM-DD" day keys. */
function dateRangeLabel(rows: readonly ImportRow[]): string {
  if (rows.length === 0) return '';
  const days = rows.map((r) => r.day).sort();
  const toDate = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d);
  };
  const first = toDate(days[0]!);
  const last = toDate(days[days.length - 1]!);
  const withYear = (d: Date) => `${formatShortDate(d)}, ${d.getFullYear()}`;
  if (days[0] === days[days.length - 1]) return withYear(last);
  const from =
    first.getFullYear() === last.getFullYear() ? formatShortDate(first) : withYear(first);
  return `${from} – ${withYear(last)}`;
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

function Card({ children, strong = false }: { children: ReactNode; strong?: boolean }) {
  return (
    <Glass
      variant={strong ? 'strong' : 'light'}
      radius={strong ? radius.card : radius.cardSmall}
      contentStyle={styles.card}
    >
      {children}
    </Glass>
  );
}

/** A column choice in the mapping step: a pill with a check when selected. */
function ColumnChip({
  label,
  selected,
  onPress,
  group,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  group: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={`${group}: ${label}`}
      accessibilityState={{ checked: selected, selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.accentTint : colors.neutralTint,
          borderColor: selected ? colors.accentInk : 'transparent',
        },
        pressed && styles.pressed,
      ]}
    >
      {selected ? <Icon name="check" size={iconSize.sm} color={colors.accentInk} /> : null}
      <AppText variant="bodyStrong" color={selected ? colors.accentInk : colors.ink}>
        {label}
      </AppText>
    </Pressable>
  );
}

function ColumnPicker({
  title,
  labels,
  value,
  onChange,
}: {
  title: string;
  labels: readonly string[];
  value: number;
  onChange: (column: number) => void;
}) {
  return (
    <View style={styles.pickerGroup}>
      <AppText variant="heading">{title}</AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={title}>
        {labels.map((label, i) => (
          <ColumnChip
            key={i}
            group={title}
            label={label}
            selected={value === i}
            onPress={() => onChange(i)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * Settings → Import from CSV. The file is read and parsed on this phone; only the extracted
 * fields of each row (date, amount, description) are kept, the text is dropped (D-011).
 */
export function ImportCsvScreen() {
  const router = useRouter();
  const source = useDataSource();
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>({ kind: 'start' });
  /** The parsed file, held in memory only while the user may still change the columns. */
  const tableRef = useRef<CsvTable | null>(null);
  const rowsRef = useRef<ImportRow[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      tableRef.current = null;
      rowsRef.current = [];
    };
  }, []);

  const available = !!source.checkImport && !!source.importRows;

  async function preview(plan: ImportPlan, planName: string) {
    const table = tableRef.current;
    if (!table || !source.checkImport) return;
    const read = readRows(table, plan);
    if (read.total > MAX_IMPORT_ROWS) {
      tableRef.current = null;
      setStep({
        kind: 'start',
        error: `This file has more than ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows. Export a shorter date range and import it in parts.`,
      });
      return;
    }
    if (read.rows.length === 0) {
      setStep(
        plan.kind === 'format'
          ? { kind: 'start', error: 'No transactions found in this file.' }
          : mappingStep(table),
      );
      return;
    }
    setStep({ kind: 'reading' });
    const check = await source.checkImport(read.rows);
    if (!mounted.current) return;
    rowsRef.current = read.rows;
    setStep({ kind: 'preview', planName, read, check, canRemap: plan.kind === 'format' });
  }

  function mappingStep(table: CsvTable): Step {
    const mapping = guessMapping(table);
    return { kind: 'mapping', mapping, labels: columnLabels(table, mapping.headerRow) };
  }

  async function chooseFile() {
    setStep({ kind: 'reading' });
    try {
      const text = await pickCsvText();
      if (!mounted.current) return;
      if (text === null) {
        setStep({ kind: 'start' });
        return;
      }
      const table = parseCsv(text);
      if (table.length === 0) {
        setStep({ kind: 'start', error: 'This file is empty.' });
        return;
      }
      tableRef.current = table;
      const plan = detectFormat(table);
      if (plan && plan.kind === 'format') await preview(plan, plan.format.name);
      else setStep(mappingStep(table));
    } catch (error) {
      // The error is not shown or logged: it could echo file contents.
      if (!mounted.current) return;
      setStep({
        kind: 'start',
        error:
          error instanceof CsvFileTooLargeError
            ? 'This file is too large. Export a shorter date range and import it in parts.'
            : 'Steadily could not read that file. Check that it is a CSV export.',
      });
    }
  }

  async function runImport() {
    const rows = rowsRef.current;
    if (!source.importRows || rows.length === 0) return;
    // The columns are settled: drop the parsed file.
    tableRef.current = null;
    setStep({ kind: 'importing', done: 0, total: 0 });
    try {
      const result = await source.importRows(rows, (done, total) => {
        if (mounted.current) setStep({ kind: 'importing', done, total });
      });
      rowsRef.current = [];
      if (mounted.current) setStep({ kind: 'done', result });
    } catch {
      if (mounted.current) setStep({ kind: 'failed' });
    }
  }

  return (
    <Screen withTabBar={false}>
      <ScreenHeader
        title="Import from CSV"
        onBack={() => router.back()}
        backIcon="close"
        backLabel="Close"
      />
      {!available ? (
        <Card>
          <AppText variant="body" color={colors.ink2}>
            Import isn't available here.
          </AppText>
        </Card>
      ) : step.kind === 'start' || step.kind === 'reading' ? (
        <StartStep
          busy={step.kind === 'reading'}
          error={step.kind === 'start' ? step.error : undefined}
          onChoose={() => void chooseFile()}
        />
      ) : step.kind === 'mapping' ? (
        <MappingStep
          key="mapping"
          table={tableRef.current}
          initial={step.mapping}
          labels={step.labels}
          onContinue={(mapping) => void preview({ kind: 'mapping', mapping }, 'Your columns')}
          onCancel={() => {
            tableRef.current = null;
            setStep({ kind: 'start' });
          }}
        />
      ) : step.kind === 'preview' ? (
        <PreviewStep
          planName={step.planName}
          read={step.read}
          check={step.check}
          onImport={() => void runImport()}
          onRemap={
            step.canRemap && tableRef.current
              ? () => setStep(mappingStep(tableRef.current!))
              : undefined
          }
        />
      ) : step.kind === 'importing' ? (
        <ImportingStep done={step.done} total={step.total} />
      ) : step.kind === 'done' ? (
        <DoneStep
          result={step.result}
          onReview={() => router.replace('/review')}
          onDone={() => router.back()}
        />
      ) : (
        <Card>
          <View style={styles.stack} accessibilityRole="alert">
            <AppText variant="heading">The import stopped</AppText>
            <AppText variant="body" color={colors.ink2}>
              Transactions imported so far are saved. Import the same file again to add the rest;
              nothing is added twice.
            </AppText>
          </View>
          <Button label="Done" onPress={() => router.back()} style={styles.action} />
        </Card>
      )}
    </Screen>
  );
}

function StartStep({
  busy,
  error,
  onChoose,
}: {
  busy: boolean;
  error: string | undefined;
  onChoose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <>
      <Card strong>
        <View style={styles.stack}>
          <OnDeviceBadge />
          <AppText variant="heading">Bring in past transactions</AppText>
          <AppText variant="body" color={colors.ink2}>
            Download a CSV of your transactions from your bank's website, then choose it here.
            Steadily reads it on this phone and keeps only the date, amount and description of each
            transaction. The file itself is not kept or uploaded.
          </AppText>
        </View>
        <Button
          label={busy ? 'Reading the file…' : 'Choose a CSV file'}
          onPress={onChoose}
          disabled={busy}
          style={styles.action}
        />
      </Card>
      {error ? (
        <View
          style={[styles.notice, { backgroundColor: colors.headsUp.bg }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <AppText variant="bodyStrong" color={colors.headsUp.text}>
            {error}
          </AppText>
        </View>
      ) : null}
      <AppText variant="caption" color={colors.ink2}>
        {SUPPORTED}
      </AppText>
    </>
  );
}

function MappingStep({
  table,
  initial,
  labels,
  onContinue,
  onCancel,
}: {
  table: CsvTable | null;
  initial: ColumnMapping;
  labels: readonly string[];
  onContinue: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  const [mapping, setMapping] = useState(initial);
  const complete = isCompleteMapping(mapping);
  const readable = useMemo(
    () => (table && complete ? readRows(table, { kind: 'mapping', mapping }) : null),
    [table, mapping, complete],
  );
  const { amount } = mapping;
  const set = (patch: Partial<ColumnMapping>) => setMapping((m) => ({ ...m, ...patch }));

  return (
    <>
      <Card>
        <View style={styles.stack}>
          <AppText variant="heading">Which column is which?</AppText>
          <AppText variant="body" color={colors.ink2}>
            Steadily didn't recognise this file's layout. Pick the columns once and check the
            preview before anything is imported.
          </AppText>
        </View>
      </Card>

      <Card>
        <View style={styles.mappingBody}>
          <ColumnPicker
            title="Date"
            labels={labels}
            value={mapping.date}
            onChange={(date) => set({ date })}
          />
          <ColumnPicker
            title="Description"
            labels={labels}
            value={mapping.description}
            onChange={(description) => set({ description })}
          />
          <View accessibilityRole="radiogroup" accessibilityLabel="Amounts">
            <AppText variant="heading">Amounts</AppText>
            <RadioRow
              label="One amount column"
              selected={amount.kind === 'single'}
              onPress={() =>
                amount.kind !== 'single' &&
                set({ amount: { kind: 'single', column: amount.debit, spending: 'negative' } })
              }
            />
            <RadioRow
              label="Separate money out and money in columns"
              selected={amount.kind === 'split'}
              onPress={() =>
                amount.kind !== 'split' &&
                set({ amount: { kind: 'split', debit: amount.column, credit: -1 } })
              }
            />
          </View>
          {amount.kind === 'single' ? (
            <>
              <ColumnPicker
                title="Amount"
                labels={labels}
                value={amount.column}
                onChange={(column) => set({ amount: { ...amount, column } })}
              />
              <View accessibilityRole="radiogroup" accessibilityLabel="Spending is shown as">
                <AppText variant="heading">Spending is shown as</AppText>
                <RadioRow
                  label="Negative, like -12.00"
                  description="Most bank accounts"
                  selected={amount.spending === 'negative'}
                  onPress={() => set({ amount: { ...amount, spending: 'negative' } })}
                />
                <RadioRow
                  label="Positive, like 12.00"
                  description="Many credit cards"
                  selected={amount.spending === 'positive'}
                  onPress={() => set({ amount: { ...amount, spending: 'positive' } })}
                />
              </View>
            </>
          ) : (
            <>
              <ColumnPicker
                title="Money out"
                labels={labels}
                value={amount.debit}
                onChange={(debit) => set({ amount: { ...amount, debit } })}
              />
              <ColumnPicker
                title="Money in"
                labels={labels}
                value={amount.credit}
                onChange={(credit) => set({ amount: { ...amount, credit } })}
              />
            </>
          )}
        </View>
      </Card>

      <AppText variant="caption" color={colors.ink2} accessibilityLiveRegion="polite">
        {readable
          ? `${plural(readable.rows.length, 'transaction', 'transactions')} readable with these columns${
              readable.skipped > 0 ? `, ${plural(readable.skipped, 'row', 'rows')} not` : ''
            }.`
          : 'Pick a date, description and amount column.'}
      </AppText>
      <Button
        label="Preview"
        onPress={() => onContinue(mapping)}
        disabled={!readable || readable.rows.length === 0}
      />
      <Button label="Choose another file" variant="link" onPress={onCancel} />
    </>
  );
}

function PreviewStep({
  planName,
  read,
  check,
  onImport,
  onRemap,
}: {
  planName: string;
  read: ReadResult;
  check: ImportCheck;
  onImport: () => void;
  onRemap: (() => void) | undefined;
}) {
  const { colors } = useTheme();
  const fresh = read.rows.filter((_, i) => check.statuses[i] === 'new');
  const sample = fresh.slice(0, SAMPLE_ROWS);
  const skippedExisting = check.duplicateCount + check.alreadyImportedCount;

  return (
    <>
      <Card strong>
        <View style={styles.stack}>
          <View style={styles.titleRow}>
            <AppText variant="label" color={colors.ink2} style={styles.flex}>
              {planName}
            </AppText>
            <OnDeviceBadge />
          </View>
          <AppText variant="title">
            {plural(read.rows.length, 'transaction', 'transactions')}
          </AppText>
          <AppText variant="body" color={colors.ink2}>
            {dateRangeLabel(read.rows)}
          </AppText>
        </View>
        <View style={[styles.counts, { borderTopColor: colors.hairline }]}>
          <AppText variant="bodyStrong">{plural(check.newCount, 'new', 'new')} to import</AppText>
          {check.duplicateCount > 0 ? (
            <AppText variant="body" color={colors.ink2}>
              {plural(check.duplicateCount, 'is', 'are')} already in Steadily from your alerts or
              entries, and will be skipped.
            </AppText>
          ) : null}
          {check.alreadyImportedCount > 0 ? (
            <AppText variant="body" color={colors.ink2}>
              {plural(check.alreadyImportedCount, 'was', 'were')} imported before, and will be
              skipped.
            </AppText>
          ) : null}
          {read.skipped > 0 ? (
            <AppText variant="body" color={colors.ink2}>
              {plural(read.skipped, 'row', 'rows')} left out (pending, balance lines or unreadable).
            </AppText>
          ) : null}
        </View>
      </Card>

      {sample.length > 0 ? (
        <>
          <SectionLabel>First few</SectionLabel>
          <Card>
            {sample.map((row, i) => {
              const name = row.description
                ? normalizeMerchant(row.description).name || row.description
                : 'No description';
              const signed = row.direction === 'credit' ? row.amountMinor : -row.amountMinor;
              const amountText =
                row.direction === 'credit'
                  ? `+${formatMoney(row.amountMinor)}`
                  : formatMoney(row.amountMinor);
              return (
                <View
                  key={row.id}
                  style={[
                    styles.sampleRow,
                    i > 0 && [styles.divider, { borderTopColor: colors.hairline }],
                  ]}
                  accessible
                  accessibilityLabel={`${name}, ${
                    signed < 0 ? spokenMoney(row.amountMinor) : `${spokenMoney(row.amountMinor)} in`
                  }`}
                >
                  <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
                    {name}
                  </AppText>
                  <AppText
                    variant="amount"
                    color={row.direction === 'credit' ? colors.onTrack : colors.ink}
                  >
                    {amountText}
                  </AppText>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <AppText variant="caption" color={colors.ink2}>
        Steadily sorts them into categories on this phone. Ones it isn't sure about wait in your
        review queue.
      </AppText>
      <Button
        label={
          check.newCount === 0
            ? 'Nothing new to import'
            : `Import ${plural(check.newCount, 'transaction', 'transactions')}`
        }
        onPress={onImport}
        disabled={check.newCount === 0}
      />
      {onRemap ? (
        <Button label="Not right? Choose the columns yourself" variant="link" onPress={onRemap} />
      ) : null}
    </>
  );
}

function ImportingStep({ done, total }: { done: number; total: number }) {
  const { colors } = useTheme();
  const ratio = total > 0 ? done / total : 0;
  const label =
    total > 0
      ? `Importing ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}…`
      : 'Getting ready…';
  return (
    <Card strong>
      <View style={styles.stack}>
        <AppText variant="heading" accessibilityLiveRegion="polite">
          {label}
        </AppText>
        <View
          style={[styles.track, { backgroundColor: colors.track }]}
          accessibilityRole="progressbar"
          accessibilityLabel="Import progress"
          accessibilityValue={{ min: 0, max: Math.max(total, 1), now: done }}
        >
          <View
            style={[
              styles.fill,
              { backgroundColor: colors.accent, width: `${Math.round(ratio * 100)}%` },
            ]}
          />
        </View>
        <AppText variant="caption" color={colors.ink2}>
          Keep Steadily open until this finishes.
        </AppText>
      </View>
    </Card>
  );
}

function DoneStep({
  result,
  onReview,
  onDone,
}: {
  result: ImportResult;
  onReview: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const skipped = result.duplicates + result.alreadyImported;
  return (
    <Card strong>
      <View style={styles.stack} accessibilityLiveRegion="polite">
        <View style={styles.titleRow}>
          <View style={[styles.doneIcon, { backgroundColor: colors.status.onTrack.bg }]}>
            <Icon name="check" size={iconSize.md} color={colors.status.onTrack.text} />
          </View>
          <AppText variant="heading" style={styles.flex}>
            Imported {plural(result.imported, 'transaction', 'transactions')}
          </AppText>
        </View>
        {result.needsReview > 0 ? (
          <AppText variant="body" color={colors.ink2}>
            {plural(result.needsReview, 'needs', 'need')} a category from you.
          </AppText>
        ) : null}
        {skipped > 0 ? (
          <AppText variant="body" color={colors.ink2}>
            {plural(skipped, 'was', 'were')} already in Steadily and skipped.
          </AppText>
        ) : null}
      </View>
      <View style={styles.actions}>
        {result.needsReview > 0 ? <Button label="Review now" onPress={onReview} /> : null}
        <Button
          label="Done"
          variant={result.needsReview > 0 ? 'secondary' : 'primary'}
          onPress={onDone}
        />
      </View>
    </Card>
  );
}

const TRACK = 10;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: layout.cardPadding, gap: space.lg },
  stack: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  action: { marginTop: space.xs },
  actions: { gap: space.sm },
  notice: { borderRadius: radius.row, padding: space.lg },
  counts: { gap: space.xs, borderTopWidth: StyleSheet.hairlineWidth * 2, paddingTop: space.md },
  mappingBody: { gap: space.xl },
  pickerGroup: { gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: layout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  pressed: { opacity: 0.7 },
  sampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
    paddingVertical: layout.rowPaddingVertical,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth * 2 },
  track: { height: TRACK, borderRadius: TRACK / 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: TRACK / 2 },
  doneIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
