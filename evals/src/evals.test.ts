import { beforeAll, describe, expect, it } from 'vitest';
import { BUILT_IN_CATEGORY_IDS } from '@steadily/taxonomy';
import { runCategorizeEval, type CategorizeReport } from './categorize';
import { loadDataset, SYNTHETIC_DATASET } from './dataset';
import { runParserEval } from './parser';
import { categorizeMarkdown, parserMarkdown } from './report';

/**
 * Measured baseline on the synthetic set. Raise it when the categorizer or the
 * dictionary improves; a drop below it is a regression.
 */
const BASELINE = {
  overallAccuracy: 0.94, // 287/305 measured 2026-10-16 (was 246/266 = 92.5%)
  autoSavedAccuracy: 0.99, // measured 204/204; a wrong silent auto-save is the worst failure
};

describe('parser eval', () => {
  const report = runParserEval();

  it('passes every rule-pack fixture', () => {
    expect(report.issuers.flatMap((s) => s.failures)).toEqual([]);
    expect(report.amountAccuracy).toBe(1);
    expect(report.merchantAccuracy).toBe(1);
    expect(report.negativeAccuracy).toBe(1);
    expect(report.exactAccuracy).toBe(1);
  });

  it('covers every bundled pack', () => {
    expect(report.issuers.length).toBeGreaterThanOrEqual(14);
    expect(parserMarkdown(report)).toContain('| zelle |');
  });
});

describe('categorizer eval (synthetic)', () => {
  const { items } = loadDataset(SYNTHETIC_DATASET);
  let report: CategorizeReport;
  beforeAll(async () => {
    report = await runCategorizeEval(items);
  });

  it('has at least 200 items across all 15 categories', () => {
    expect(items.length).toBeGreaterThanOrEqual(200);
    const used = new Set(items.map((i) => i.expectedCategoryId));
    expect([...used].sort()).toEqual([...BUILT_IN_CATEGORY_IDS].sort());
  });

  it('is at least 99% accurate on what it auto-saves', () => {
    expect(report.autoSavedAccuracy).toBeGreaterThanOrEqual(BASELINE.autoSavedAccuracy);
  });

  it('does not regress below the recorded overall baseline', () => {
    expect(report.accuracy).toBeGreaterThanOrEqual(BASELINE.overallAccuracy);
  });

  it('sends every payment to a person and every multi-category default to review', () => {
    expect(report.reviewAgreement).toBe(1);
  });

  it('renders a markdown report', () => {
    const md = categorizeMarkdown(report, { title: 'synthetic', showMerchants: false });
    expect(md).toContain('Overall accuracy');
    expect(md).not.toContain('`');
  });
});
