import { userRules } from '@steadily/db';
import { createTestDb, type NodeDb } from '@steadily/db/node';
import { Transaction } from '@steadily/shared-types';
import { isBuiltInCategoryId } from '@steadily/taxonomy';

import { readAppValue } from '../appSettings';
import { issuerHealth } from '../issuerHealth';
import { createRepoDataSource, type AlertCapture } from '../repoDataSource';
import { createAppLogger, createAppRuntime } from '../runtime';
import { sampleAlerts } from '../sampleAlerts';

/** Thursday, October 15 2026, 9:30 AM local time. */
const NOW = new Date(2026, 9, 15, 9, 30);
const MONTH = {
  from: new Date(2026, 9, 1).toISOString(),
  to: new Date(2026, 10, 1).toISOString(),
};
const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();

const newId = () => globalThis.crypto.randomUUID();

/** A data source over `db` with its own runtime, like a fresh app launch. */
function launch(db: NodeDb = createTestDb().db) {
  const app = createAppRuntime(db, { newId, clock: () => NOW, log: createAppLogger(false) });
  const source = createRepoDataSource({
    db,
    ...app,
    newId,
    now: () => NOW,
    sampleAlerts: () => sampleAlerts(NOW),
  });
  return { db, source, ...app };
}

// Synthetic alerts: made-up people, merchants and card endings.
const PERSON: AlertCapture = {
  text: 'Venmo: You paid Sam Example $12.00 for pizza',
  source: 'ios_sms_shortcut',
  occurredAt: at(14),
};
const UNKNOWN_SHOP: AlertCapture = {
  text: 'Chase Freedom (...4821): You made a $40.00 transaction with ZQX HOLDINGS 991.',
  source: 'ios_sms_shortcut',
  occurredAt: at(13),
};
const COFFEE: AlertCapture = {
  text: 'You made a $5 transaction with SQ *BLUE BOTTLE COFFEE on your card ending in 1234',
  source: 'android_notification',
  androidPackage: 'com.chase.sig.android',
  occurredAt: at(12),
};

describe('repo data source', () => {
  it('captures alerts into the review queue with up to three chips', async () => {
    const { source, db } = launch();
    await source.captureAlerts([PERSON, UNKNOWN_SHOP, COFFEE]);

    const txs = await source.listTransactions(MONTH);
    expect(txs).toHaveLength(3);
    for (const tx of txs) expect(Transaction.safeParse(tx).success).toBe(true);
    // Newest first.
    expect(txs.map((t) => t.amountMinor)).toEqual([1_200, 4_000, 500]);
    // The coffee shop is a known merchant: logged without asking.
    expect(txs[2]).toMatchObject({ status: 'confirmed', categoryId: 'food.coffee' });

    const queue = await source.listNeedsReview();
    // Oldest first.
    expect(queue.map((i) => i.transaction.amountMinor)).toEqual([4_000, 1_200]);
    for (const item of queue) {
      expect(item.suggestedCategoryIds.length).toBeGreaterThan(0);
      expect(item.suggestedCategoryIds.length).toBeLessThanOrEqual(3);
      expect(item.suggestedCategoryIds.every(isBuiltInCategoryId)).toBe(true);
      expect(item.suggestedCategoryIds[0]).toBe(item.transaction.categoryId);
      expect(new Set(item.suggestedCategoryIds).size).toBe(item.suggestedCategoryIds.length);
    }
    // A payment to a person offers the P2P chips (D-009).
    expect(queue[1]!.suggestedCategoryIds).toEqual(
      expect.arrayContaining(['housing.rent_mortgage']),
    );
    // Raw alert text is gone once parsed (D-011).
    expect(db.$client.prepare('SELECT count(*) AS n FROM inbox').get()).toEqual({ n: 0 });
  });

  it('confirms a category: confirmed, rule learned, budget spent updated', async () => {
    const { source, db } = launch();
    const budget = await source.setBudget({ categoryId: 'shopping.general', amountMinor: 10_000 });
    await source.captureAlerts([UNKNOWN_SHOP]);
    const [item] = await source.listNeedsReview();
    const listener = jest.fn();
    source.subscribe(listener);

    expect((await source.listBudgets(MONTH))[0]!.spentMinor).toBe(0);
    await source.confirmCategory(item!.transaction.id, 'shopping.general', false);

    expect(listener).toHaveBeenCalled();
    expect(await source.getTransaction(item!.transaction.id)).toMatchObject({
      categoryId: 'shopping.general',
      categorySource: 'user',
      status: 'confirmed',
    });
    expect(await source.listNeedsReview()).toEqual([]);
    const rules = db.select().from(userRules).all();
    expect(rules).toEqual([
      expect.objectContaining({ pattern: 'zqx_holdings', categoryId: 'shopping.general' }),
    ]);
    const [row] = await source.listBudgets(MONTH);
    expect(row).toMatchObject({ budget: { id: budget.id }, spentMinor: 4_000 });

    // The next charge there uses the rule.
    await source.captureAlerts([{ ...UNKNOWN_SHOP, occurredAt: at(14) }]);
    expect(await source.listNeedsReview()).toEqual([]);
    expect((await source.listBudgets(MONTH))[0]!.spentMinor).toBe(8_000);
  });

  it('marks not an expense, with a merchant rule but never one for a person', async () => {
    const { source, db } = launch();
    await source.setBudget({ categoryId: null, amountMinor: 100_000 });
    await source.captureAlerts([PERSON, UNKNOWN_SHOP]);
    const before = (await source.listBudgets(MONTH))[0]!.spentMinor;
    expect(before).toBe(5_200);

    for (const item of await source.listNeedsReview()) {
      await source.markNotExpense(item.transaction.id);
    }
    expect(await source.listNeedsReview()).toEqual([]);
    expect((await source.listBudgets(MONTH))[0]!.spentMinor).toBe(0);
    const txs = await source.listTransactions(MONTH);
    expect(txs.every((t) => t.kind === 'transfer' && t.status === 'confirmed')).toBe(true);

    const rules = db.select().from(userRules).all();
    expect(rules.map((r) => [r.pattern, r.kind])).toEqual([['zqx_holdings', 'transfer']]);

    // Choosing a category makes it spending again and drops the transfer rule.
    const shop = txs.find((t) => t.amountMinor === 4_000)!;
    await source.confirmCategory(shop.id, 'shopping.general', false);
    expect(await source.getTransaction(shop.id)).toMatchObject({
      kind: 'expense',
      categoryId: 'shopping.general',
    });
    expect(db.select().from(userRules).all()[0]).toMatchObject({ kind: null });
    expect((await source.listBudgets(MONTH))[0]!.spentMinor).toBe(4_000);
  });

  it('persists settings, onboarding and issuer state across launches', async () => {
    const first = launch();
    expect(await first.source.getOnboarding()).toEqual({ completed: false, step: 'welcome' });
    await first.source.saveOnboarding({ step: 'setup' });
    await first.source.setSelectedIssuers(['chase', 'discover']);
    await first.source.setIssuerSetupStatus('discover', 'done');
    await first.source.updateSettings({ theme: 'dark', quietHours: null });
    await first.source.captureAlerts([COFFEE]);

    const again = launch(first.db).source;
    expect(await again.getOnboarding()).toEqual({ completed: false, step: 'setup' });
    expect(await again.getSettings()).toMatchObject({ theme: 'dark', quietHours: null });
    const setups = await again.listIssuerSetup();
    const chase = setups.find((s) => s.issuerId === 'chase')!;
    const discover = setups.find((s) => s.issuerId === 'discover')!;
    expect(chase).toMatchObject({ selected: true, setupStatus: 'pending' });
    expect(chase.lastAlertAt).toBe(NOW.toISOString());
    expect(issuerHealth(chase, NOW)).toBe('receiving');
    expect(discover).toMatchObject({ selected: true, setupStatus: 'done', lastAlertAt: null });
    expect(issuerHealth(discover, NOW)).toBe('waiting');
    expect(setups.filter((s) => s.selected)).toHaveLength(2);

    // Dropping and re-adding an issuer starts its setup over.
    await again.setSelectedIssuers(['chase']);
    await again.setSelectedIssuers(['chase', 'discover']);
    const discoverAgain = (await again.listIssuerSetup()).find((s) => s.issuerId === 'discover');
    expect(discoverAgain).toMatchObject({ selected: true, setupStatus: 'pending' });

    await again.saveOnboarding({ completed: true });
    expect(await launch(first.db).source.getOnboarding()).toEqual({
      completed: true,
      step: 'setup',
    });
    // App-only keys never leak into the Settings contract.
    expect(Object.keys(await again.getSettings())).not.toContain('app.onboarding');
    expect(readAppValue(first.db, 'app.onboarding')).toEqual({ completed: true, step: 'setup' });
  });

  it('creates, replaces and deletes budgets', async () => {
    const { source } = launch();
    await source.setBudget({ categoryId: 'food.coffee', amountMinor: 4_000 });
    await source.setBudget({ categoryId: 'food.coffee', amountMinor: 5_000 });
    await source.setBudget({ categoryId: null, amountMinor: 100_000 });
    let rows = await source.listBudgets(MONTH);
    expect(rows.map((r) => [r.budget.categoryId, r.budget.amountMinor])).toEqual([
      [null, 100_000],
      ['food.coffee', 5_000],
    ]);
    await expect(source.setBudget({ categoryId: null, amountMinor: 0 })).rejects.toThrow();
    await source.deleteBudget(rows[1]!.budget.id);
    rows = await source.listBudgets(MONTH);
    expect(rows.map((r) => r.budget.categoryId)).toEqual([null]);
    // Deleted budgets stay deleted after a relaunch, and a new one can take the category.
    await source.setBudget({ categoryId: 'food.coffee', amountMinor: 3_000 });
    expect((await source.listBudgets(MONTH)).map((r) => r.budget.amountMinor)).toEqual([
      100_000, 3_000,
    ]);
  });

  it('saves notes and seeds the sample alerts through the pipeline', async () => {
    const { source } = launch();
    const count = await source.seedSampleData!();
    expect(count).toBeGreaterThan(20);
    const txs = await source.listTransactions(MONTH);
    expect(txs.length).toBeGreaterThan(15);
    expect(txs.every((t) => t.occurredAt <= NOW.toISOString())).toBe(true);

    await source.setNote(txs[0]!.id, '  team lunch  ');
    expect((await source.getTransaction(txs[0]!.id))?.note).toBe('team lunch');
    await source.setNote(txs[0]!.id, '');
    expect((await source.getTransaction(txs[0]!.id))?.note).toBeNull();
  });
});
