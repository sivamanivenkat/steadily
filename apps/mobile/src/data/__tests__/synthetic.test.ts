import { Settings, Transaction } from '@steadily/shared-types';
import { isBuiltInCategoryId } from '@steadily/taxonomy';

import { issuerHealth } from '../issuerHealth';
import { createSyntheticDataSource } from '../synthetic';
import { defaultSeed, type SyntheticSeed } from '../syntheticSeed';

const NOW = new Date(2026, 9, 15, 9, 30);
const ALL = { from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' };
const make = (seed?: SyntheticSeed) =>
  createSyntheticDataSource({ now: () => NOW, ...(seed ? { seed } : {}) });

describe('synthetic data source', () => {
  it('produces transactions and settings that satisfy the shared contracts', async () => {
    const source = make();
    const txs = await source.listTransactions(ALL);
    expect(txs).toHaveLength(defaultSeed.transactions.length);
    for (const tx of txs) expect(Transaction.safeParse(tx).success).toBe(true);
    expect(Settings.safeParse(await source.getSettings()).success).toBe(true);
    // Only taxonomy categories.
    expect(txs.every((t) => isBuiltInCategoryId(t.categoryId))).toBe(true);
  });

  it('lists newest first within a half-open range', async () => {
    const source = make();
    const today = await source.listTransactions({
      from: new Date(2026, 9, 15).toISOString(),
      to: new Date(2026, 9, 16).toISOString(),
    });
    expect(today.map((t) => t.merchantName)).toEqual(['Blue Bottle Coffee', 'Corner Cafe']);
  });

  it('keeps the review queue oldest first with up to three suggestions', async () => {
    const queue = await make().listNeedsReview();
    expect(queue.map((i) => i.transaction.merchantName)).toEqual([
      'Jordan P.',
      'Amazon',
      'Alex M.',
      'Corner Cafe',
    ]);
    expect(queue.every((i) => i.suggestedCategoryIds.length <= 3)).toBe(true);
  });

  it('confirms a category and notifies subscribers', async () => {
    const source = make();
    const listener = jest.fn();
    const unsubscribe = source.subscribe(listener);
    const [item] = await source.listNeedsReview();

    await source.confirmCategory(item!.transaction.id, 'gifts.general', false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(await source.getTransaction(item!.transaction.id)).toMatchObject({
      categoryId: 'gifts.general',
      categorySource: 'user',
      categoryConfidence: 1,
      status: 'confirmed',
    });

    unsubscribe();
    await source.markNotExpense(item!.transaction.id);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('marks not an expense so it leaves budgets', async () => {
    const source = make();
    const range = {
      from: new Date(2026, 9, 1).toISOString(),
      to: new Date(2026, 10, 1).toISOString(),
    };
    const before = (await source.listBudgets(range))[0]!;
    const [item] = await source.listNeedsReview();
    await source.markNotExpense(item!.transaction.id);
    const after = (await source.listBudgets(range))[0]!;
    expect(before.budget.categoryId).toBeNull();
    expect(before.spentMinor - after.spentMinor).toBe(item!.transaction.amountMinor);
  });

  it('creates, replaces and deletes budgets', async () => {
    const source = make({ transactions: [], budgets: [], subscriptions: [] });
    await source.setBudget({ categoryId: 'food.coffee', amountMinor: 4_000 });
    await source.setBudget({ categoryId: 'food.coffee', amountMinor: 5_000 });
    await source.setBudget({ categoryId: null, amountMinor: 100_000 });
    let rows = await source.listBudgets(ALL);
    expect(rows.map((r) => [r.budget.categoryId, r.budget.amountMinor])).toEqual([
      [null, 100_000],
      ['food.coffee', 5_000],
    ]);
    await expect(source.setBudget({ categoryId: null, amountMinor: 0 })).rejects.toThrow();
    await source.deleteBudget(rows[1]!.budget.id);
    rows = await source.listBudgets(ALL);
    expect(rows).toHaveLength(1);
  });

  it('tracks issuer setup and derives alert health', async () => {
    const source = make();
    await source.setSelectedIssuers(['chase', 'discover']);
    await source.setIssuerSetupStatus('discover', 'done');
    const setups = await source.listIssuerSetup();
    const chase = setups.find((s) => s.issuerId === 'chase')!;
    const discover = setups.find((s) => s.issuerId === 'discover')!;
    expect(chase).toMatchObject({ selected: true, setupStatus: 'pending' });
    expect(issuerHealth(chase, NOW)).toBe('receiving');
    expect(issuerHealth(discover, NOW)).toBe('waiting');

    // Dropping and re-adding an issuer starts its setup over.
    await source.setSelectedIssuers(['chase']);
    await source.setSelectedIssuers(['chase', 'discover']);
    const again = (await source.listIssuerSetup()).find((s) => s.issuerId === 'discover')!;
    expect(again.setupStatus).toBe('pending');
    expect(issuerHealth(again, NOW)).toBe('not_set_up');
    expect(issuerHealth({ ...again, lastAlertAt: new Date(2026, 9, 1).toISOString() }, NOW)).toBe(
      'quiet',
    );
  });

  it('saves onboarding progress and settings', async () => {
    const source = make();
    expect(await source.getOnboarding()).toEqual({ completed: false, step: 'welcome' });
    await source.saveOnboarding({ step: 'setup' });
    expect(await source.getOnboarding()).toEqual({ completed: false, step: 'setup' });

    expect((await source.getSettings()).cloudAiOptIn).toBe(false);
    await source.updateSettings({ theme: 'dark', cloudAiOptIn: true });
    expect(await source.getSettings()).toMatchObject({ theme: 'dark', cloudAiOptIn: true });
  });

  it('flags subscription price increases', async () => {
    const subs = await make().listSubscriptions();
    const netflix = subs.find((s) => s.subscription.merchantName === 'Netflix');
    expect(netflix).toMatchObject({ previousAmountMinor: 1549 });
    expect(netflix?.subscription.amountMinor).toBe(1799);
  });
});
