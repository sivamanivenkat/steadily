import { parseCsv } from '@steadily/csv-import';
import { fireEvent, screen } from '@testing-library/react-native';

import { defaultSeed } from '@/data/syntheticSeed';
import { canShareFiles, clearExportFiles, shareCsv } from '@/lib/csvFiles';
import { FIXED_NOW, makeSource, renderWithData } from '@/testing/render';
import { resetRouter } from '@/testing/router';

import { ExportCsvScreen, exportRange } from '../ExportCsvScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);
jest.mock('@/lib/csvFiles', () => ({
  canShareFiles: jest.fn(async () => true),
  clearExportFiles: jest.fn(),
  shareCsv: jest.fn(async () => {}),
}));

const share = shareCsv as jest.MockedFunction<typeof shareCsv>;
const canShare = canShareFiles as jest.MockedFunction<typeof canShareFiles>;

describe('ExportCsvScreen', () => {
  beforeEach(() => {
    resetRouter();
    share.mockClear();
    canShare.mockResolvedValue(true);
  });

  it('warns that the file leaves Steadily and exports the chosen range', async () => {
    const source = makeSource(defaultSeed);
    const { unmount } = await renderWithData(<ExportCsvScreen />, source);
    expect(clearExportFiles).toHaveBeenCalled();
    expect(screen.getByText('Before you export')).toBeOnTheScreen();
    expect(screen.getByText(/leaves Steadily’s protection/)).toBeOnTheScreen();

    const month = await source.listTransactions(exportRange('month', FIXED_NOW));
    const all = await source.listTransactions(exportRange('all', FIXED_NOW));
    expect(all.length).toBeGreaterThan(month.length);

    await fireEvent.press(screen.getByRole('radio', { name: 'Everything' }));
    const button = await screen.findByRole('button', { name: `Export ${all.length} transactions` });
    await fireEvent.press(button);

    expect(await screen.findByText(/Done\./)).toBeOnTheScreen();
    expect(share).toHaveBeenCalledTimes(1);
    const [fileName, text] = share.mock.calls[0]!;
    expect(fileName).toBe('steadily-transactions-2026-10-15.csv');
    const table = parseCsv(text);
    expect(table[0]).toEqual([
      'Date',
      'Merchant',
      'Category',
      'Amount',
      'Currency',
      'Kind',
      'Status',
      'Source',
      'Note',
    ]);
    expect(table).toHaveLength(all.length + 1);
    // Oldest first.
    const dates = table.slice(1).map((row) => row[0]!);
    expect([...dates].sort()).toEqual(dates);

    (clearExportFiles as jest.Mock).mockClear();
    await unmount();
    expect(clearExportFiles).toHaveBeenCalled();
  });

  it('has nothing to export in an empty range', async () => {
    await renderWithData(
      <ExportCsvScreen />,
      makeSource({ transactions: [], budgets: [], subscriptions: [] }),
    );
    expect(
      await screen.findByRole('button', { name: 'Nothing to export in this range' }),
    ).toBeDisabled();
  });

  it('says so when the device cannot share files', async () => {
    canShare.mockResolvedValue(false);
    await renderWithData(<ExportCsvScreen />, makeSource(defaultSeed));
    await fireEvent.press(await screen.findByRole('button', { name: /^Export \d+ transactions$/ }));
    expect(
      await screen.findByText('Sharing files isn’t available on this device.'),
    ).toBeOnTheScreen();
    expect(share).not.toHaveBeenCalled();
  });
});
