import { createTestDb } from '@steadily/db/node';

import { emptySeed } from '@/testing/render';

import { createRepoDataSource, type AlertCapture } from '../repoDataSource';
import { createAppLogger, createAppRuntime } from '../runtime';
import { createSyntheticDataSource } from '../synthetic';
import { defaultSeed } from '../syntheticSeed';

const NOW = new Date(2026, 9, 15, 9, 30);
const newId = () => globalThis.crypto.randomUUID();

function launch(encryptedAtRest?: boolean) {
  const { db } = createTestDb();
  const app = createAppRuntime(db, { newId, clock: () => NOW, log: createAppLogger(false) });
  return createRepoDataSource({
    db,
    ...app,
    newId,
    now: () => NOW,
    ...(encryptedAtRest === undefined ? {} : { encryptedAtRest }),
  });
}

// Synthetic alerts: made-up merchants and card endings.
const COFFEE: AlertCapture = {
  text: 'You made a $5 transaction with SQ *BLUE BOTTLE COFFEE on your card ending in 1234',
  source: 'android_notification',
  androidPackage: 'com.chase.sig.android',
  occurredAt: new Date(2026, 9, 12, 12).toISOString(),
};
const UNKNOWN_SHOP: AlertCapture = {
  text: 'Chase Freedom (...4821): You made a $40.00 transaction with ZQX HOLDINGS 991.',
  source: 'ios_sms_shortcut',
  occurredAt: new Date(2026, 9, 13, 12).toISOString(),
};

describe('privacy summary', () => {
  it('counts stored rows in the database', async () => {
    const source = launch(true);
    expect(await source.getPrivacySummary!()).toEqual({
      transactions: 0,
      budgets: 0,
      subscriptions: 0,
      rules: 0,
      encryptedAtRest: true,
    });

    await source.captureAlerts([COFFEE, UNKNOWN_SHOP]);
    await source.setBudget({ categoryId: null, amountMinor: 200_000 });
    const [, shop] = (
      await source.listTransactions({ from: '2000-01-01T00:00:00Z', to: '2100-01-01T00:00:00Z' })
    ).reverse();
    // "Remember for this merchant" teaches a rule.
    await source.confirmCategory(shop!.id, 'shopping.general', true);

    expect(await source.getPrivacySummary!()).toMatchObject({
      transactions: 2,
      budgets: 1,
      subscriptions: 0,
      rules: 1,
    });
  });

  it('is not encrypted unless the app says so', async () => {
    expect((await launch().getPrivacySummary!()).encryptedAtRest).toBe(false);
  });

  it('synthetic source: counts and delete-all start over at onboarding', async () => {
    const source = createSyntheticDataSource({
      now: () => NOW,
      seed: { ...defaultSeed, onboarding: { completed: true, step: 'waiting' } },
    });
    const before = await source.getPrivacySummary!();
    expect(before.transactions).toBe(defaultSeed.transactions.length);
    expect(before.budgets).toBe(defaultSeed.budgets.length);
    expect(before.subscriptions).toBe(defaultSeed.subscriptions.length);
    expect(before.encryptedAtRest).toBe(false);

    await source.updateSettings({ cloudAiOptIn: true });
    await source.deleteAllData!();

    expect(await source.getPrivacySummary!()).toMatchObject({
      transactions: 0,
      budgets: 0,
      subscriptions: 0,
      rules: 0,
    });
    expect(await source.getOnboarding()).toEqual({ completed: false, step: 'welcome' });
    expect((await source.getSettings()).cloudAiOptIn).toBe(false);
    expect((await source.listIssuerSetup()).every((i) => !i.selected)).toBe(true);
  });

  it('synthetic source with an empty seed counts nothing', async () => {
    const source = createSyntheticDataSource({ now: () => NOW, seed: emptySeed });
    expect((await source.getPrivacySummary!()).transactions).toBe(0);
  });
});
