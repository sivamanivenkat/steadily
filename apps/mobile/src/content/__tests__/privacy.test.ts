import { CaptureSource } from '@steadily/shared-types';

import type { Transaction } from '@/data/types';

import { keptFields, keptIntro, notKeptFields, SOURCE_LABEL } from '../privacy';

/** Synthetic transaction: made-up merchant and card ending. */
const base: Transaction = {
  id: '00000000-0000-4000-8000-000000000001',
  createdAt: '2026-10-10T12:00:00.000Z',
  updatedAt: '2026-10-10T12:00:00.000Z',
  deletedAt: null,
  occurredAt: '2026-10-10T12:00:00.000Z',
  amountMinor: 1_250,
  currency: 'USD',
  kind: 'expense',
  merchantRaw: 'SQ *TEST CAFE',
  merchantName: 'Test Cafe',
  categoryId: 'food.coffee',
  categoryConfidence: 0.92,
  categorySource: 'dictionary',
  status: 'confirmed',
  source: 'android_notification',
  accountLast4: '0001',
  issuerId: 'chase',
  txnRef: null,
  note: null,
  linkedTransactionId: null,
};

const asMap = (tx: Transaction) => new Map(keptFields(tx).map((f) => [f.label, f.value]));

describe('keptFields', () => {
  it('lists the stored columns with readable values', () => {
    const kept = asMap(base);
    expect(kept.get('Amount')).toBe('$12.50 USD');
    expect(kept.get('Merchant')).toBe('Test Cafe');
    expect(kept.get('Merchant as written')).toBe('SQ *TEST CAFE');
    expect(kept.get('Card')).toBe('Ending 0001');
    expect(kept.get('Bank or app')).toBe('Chase');
    expect(kept.get('Captured from')).toBe('Bank notification');
    expect(kept.get('Category')).toBe('Coffee');
    expect(kept.get('Category chosen by')).toBe('Known-merchant list on this phone');
    expect(kept.get('Reference number')).toBe('None');
    expect(kept.get('Note')).toBe('None');
  });

  it('says "Not captured" for empty columns instead of inventing values', () => {
    const kept = asMap({
      ...base,
      merchantRaw: null,
      merchantName: null,
      accountLast4: null,
      issuerId: null,
    });
    expect(kept.get('Merchant')).toBe('Not captured');
    expect(kept.get('Merchant as written')).toBe('Not captured');
    expect(kept.get('Card')).toBe('Not captured');
    expect(kept.get('Bank or app')).toBe('Not captured');
  });

  it.each([
    ['user', 'You'],
    ['user_rule', 'Your rule for this merchant'],
    ['dictionary', 'Known-merchant list on this phone'],
    ['classifier', 'Best guess on this phone'],
    ['cloud_llm', 'Cloud AI (you opted in)'],
  ] as const)('names who chose the category (%s)', (categorySource, label) => {
    expect(asMap({ ...base, categorySource }).get('Category chosen by')).toBe(label);
  });

  it('labels the capture sources in plain words', () => {
    expect(asMap({ ...base, source: 'share_text' }).get('Captured from')).toBe('Shared text');
    expect(asMap({ ...base, source: 'csv_import' }).get('Captured from')).toBe('CSV import');
    expect(asMap({ ...base, source: 'manual' }).get('Captured from')).toBe('Added by you');
  });
});

describe('notKeptFields', () => {
  const forSource = (source: CaptureSource, issuerId: string | null = 'chase') =>
    notKeptFields({ source, issuerId });

  it('every source has a label and an intro', () => {
    for (const source of CaptureSource.options) {
      expect(SOURCE_LABEL[source]).toBeTruthy();
      expect(keptIntro(source)).toMatch(/encrypted on this phone/);
    }
  });

  it('notifications: the alert text, balances, names, codes and other notifications', () => {
    const list = forSource('android_notification');
    expect(list).toEqual(
      expect.arrayContaining([
        'The full notification text',
        'Balances and available credit',
        'Full card or account numbers (only the last 4 digits)',
        'Names in it, including yours',
        'One-time codes and security messages',
        'Your other notifications: apps not on Steadily’s list are never read',
      ]),
    );
  });

  it('payments to a person say the payee name is kept as the merchant', () => {
    expect(forSource('android_notification', 'venmo')).toContain(
      'Other names in it (the person you paid is kept as the merchant)',
    );
  });

  it('text messages: the message and the sender', () => {
    const list = forSource('ios_sms_shortcut');
    expect(list).toContain('The full text message');
    expect(list).toContain('The sender’s number or short code');
  });

  it('screenshots: the image and the rest of the screen', () => {
    const list = forSource('share_image');
    expect(list).toContain('The screenshot itself');
    expect(list).toContain('All other text read from it');
  });

  it('shared text: the text and the app it came from', () => {
    expect(forSource('share_text')).toEqual(
      expect.arrayContaining(['The full text you shared', 'Which app you shared it from']),
    );
  });

  it('CSV import: the original file and unused columns', () => {
    expect(forSource('csv_import')).toEqual(
      expect.arrayContaining([
        'The original file',
        'Columns Steadily didn’t use, such as running balance',
      ]),
    );
  });

  it('typed-in transactions had nothing else to drop', () => {
    expect(forSource('manual', null)).toEqual([]);
  });

  it('every capture source except manual drops something', () => {
    for (const source of CaptureSource.options) {
      if (source === 'manual') continue;
      expect(forSource(source).length).toBeGreaterThan(0);
    }
  });
});
