import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { detectFormat, parseCsv, readRows } from '@steadily/csv-import';
import { createTestDb } from '@steadily/db/node';
import { fireEvent, screen } from '@testing-library/react-native';

import { createRepoDataSource } from '@/data/repoDataSource';
import { createAppLogger, createAppRuntime } from '@/data/runtime';
import { pickCsvText } from '@/lib/csvFiles';
import { FIXED_NOW, makeSource, renderWithData } from '@/testing/render';
import { mockRouter, resetRouter } from '@/testing/router';

import { ImportCsvScreen } from '../ImportCsvScreen';

jest.mock('expo-router', () => require('@/testing/router').routerModule);
jest.mock('@/lib/csvFiles', () => ({
  CsvFileTooLargeError: class CsvFileTooLargeError extends Error {},
  pickCsvText: jest.fn(),
}));

const pick = pickCsvText as jest.MockedFunction<typeof pickCsvText>;

/** Synthetic fixture files shared with the parser tests. */
const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '../../../../../packages/csv-import/fixtures', `${name}.csv`),
    'utf8',
  );

function repoSource() {
  const { db } = createTestDb();
  const newId = () => globalThis.crypto.randomUUID();
  const app = createAppRuntime(db, { newId, clock: () => FIXED_NOW, log: createAppLogger(false) });
  return createRepoDataSource({ db, ...app, newId, now: () => FIXED_NOW });
}

describe('ImportCsvScreen', () => {
  beforeEach(() => {
    resetRouter();
    pick.mockReset();
  });

  it('previews a recognised export and imports it through the pipeline', async () => {
    pick.mockResolvedValue(fixture('chase_card'));
    const source = repoSource();
    await renderWithData(<ImportCsvScreen />, source);

    expect(screen.getByText('On-device')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a CSV file' }));

    expect(await screen.findByText('Chase credit card')).toBeOnTheScreen();
    expect(screen.getByText('6 transactions')).toBeOnTheScreen();
    expect(screen.getByText('Oct 8 – Oct 14, 2026')).toBeOnTheScreen();
    // Merchant and amount only, merchant names normalized.
    expect(screen.getAllByText('Blue Bottle Coffee').length).toBeGreaterThan(0);
    expect(screen.getByText('+$12.50')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Import 6 transactions' }));
    expect(await screen.findByText('Imported 6 transactions')).toBeOnTheScreen();
    expect(screen.getByText('1 needs a category from you.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Review now' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/review');

    const all = await source.listTransactions({
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 10, 1).toISOString(),
    });
    expect(all).toHaveLength(6);
  });

  it('says when everything in the file is already in Steadily', async () => {
    pick.mockResolvedValue(fixture('discover'));
    const source = repoSource();
    const table = parseCsv(fixture('discover'));
    await source.importRows!(readRows(table, detectFormat(table)!).rows);

    await renderWithData(<ImportCsvScreen />, source);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a CSV file' }));
    expect(
      await screen.findByText('2 were imported before, and will be skipped.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled();
  });

  it('asks for columns when the layout is unknown', async () => {
    pick.mockResolvedValue(
      'When,What,Value\n10/14/2026,EXAMPLE KIOSK,3.00\n10/13/2026,EXAMPLE CINEMA,12.50\n',
    );
    await renderWithData(<ImportCsvScreen />, repoSource());
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a CSV file' }));

    expect(await screen.findByText('Which column is which?')).toBeOnTheScreen();
    // Guessed from the values: dates, text, positive amounts.
    expect(screen.getByRole('radio', { name: 'Date: When' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Description: What' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Amount: Value' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Positive, like 12.00' })).toBeChecked();
    expect(screen.getByText('2 transactions readable with these columns.')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('radio', { name: 'Negative, like -12.00' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Your columns')).toBeOnTheScreen();
    // Positive amounts now read as money in.
    expect(screen.getByText('+$12.50')).toBeOnTheScreen();
  });

  it('shows a plain error for an unreadable file and stays put on cancel', async () => {
    pick.mockResolvedValueOnce(null);
    await renderWithData(<ImportCsvScreen />, repoSource());
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a CSV file' }));
    expect(await screen.findByRole('button', { name: 'Choose a CSV file' })).toBeEnabled();

    pick.mockRejectedValueOnce(new Error('secret file text'));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a CSV file' }));
    expect(
      await screen.findByText('Steadily could not read that file. Check that it is a CSV export.'),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it('explains when the data source has no import', async () => {
    await renderWithData(<ImportCsvScreen />, makeSource());
    expect(screen.getByText("Import isn't available here.")).toBeOnTheScreen();
  });
});
