import type { CategorizeReport } from './categorize';
import type { ParserReport } from './parser';

const pct = (v: number | null) => (v === null ? '-' : `${(v * 100).toFixed(1)}%`);
const frac = (n: number, d: number) => `${n}/${d}`;

export function parserMarkdown(r: ParserReport): string {
  const lines = [
    '## Parser (rule-pack fixtures)',
    '',
    `Amount ${pct(r.amountAccuracy)} · merchant ${pct(r.merchantAccuracy)} · negatives rejected ${pct(r.negativeAccuracy)} · exact ${pct(r.exactAccuracy)} over ${r.totals.cases} fixtures.`,
    '',
    '| Issuer | Cases | Amount | Merchant | Negatives rejected | Exact |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const s of r.issuers) {
    lines.push(
      `| ${s.issuer} | ${s.cases} | ${frac(s.amountCorrect, s.positives)} | ${frac(s.merchantCorrect, s.positives)} | ${frac(s.negativesRejected, s.negatives)} | ${frac(s.exact, s.cases)} |`,
    );
  }
  const failures = r.issuers.flatMap((s) => s.failures.map((f) => `- ${s.issuer}: ${f}`));
  if (failures.length > 0) lines.push('', '### Failing fixtures', '', ...failures);
  return lines.join('\n');
}

export interface CategorizeMarkdownOptions {
  title: string;
  /** Print merchant descriptors in the confusion list. Off for real data (D-011). */
  showMerchants: boolean;
}

export function categorizeMarkdown(r: CategorizeReport, opts: CategorizeMarkdownOptions): string {
  const lines = [
    `## Categorizer: ${opts.title}`,
    '',
    'Deterministic on-device path: user rules (none) -> merchant dictionary -> heuristics, no LLM, no history.',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Items | ${r.total} |`,
    `| Overall accuracy | ${pct(r.accuracy)} (${frac(r.correct, r.total)}) |`,
    `| Auto-save rate | ${pct(r.autoSaveRate)} (${frac(r.autoSaved, r.total)}) |`,
    `| Accuracy among auto-saved | ${pct(r.autoSavedAccuracy)} (${frac(r.autoSavedCorrect, r.autoSaved)}) |`,
    `| Review flag agrees with label | ${pct(r.reviewAgreement)} (${r.reviewLabeled} labeled) |`,
    '',
    '### Per category',
    '',
    '| Category | Support | Predicted | Precision | Recall |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const c of r.perCategory) {
    lines.push(
      `| ${c.categoryId} | ${c.support} | ${c.predicted} | ${pct(c.precision)} | ${pct(c.recall)} |`,
    );
  }
  if (r.slices.length > 0) {
    lines.push('', '### Slices', '', '| Tag | Items | Accuracy | Auto-saved |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const s of r.slices) {
      lines.push(
        `| ${s.tag} | ${s.total} | ${pct(s.correct / s.total)} | ${frac(s.autoSaved, s.total)} |`,
      );
    }
  }
  lines.push('', `### Confusions (${r.confusions.length})`, '');
  if (r.confusions.length === 0) lines.push('None.');
  else {
    lines.push('| Item | Expected | Got | Conf. | Source | Review |');
    lines.push('| --- | --- | --- | ---: | --- | --- |');
    for (const o of r.confusions) {
      const label = opts.showMerchants
        ? `${o.item.id} \`${o.item.merchantRaw}\`${o.item.issuerId ? ` (${o.item.issuerId})` : ''}`
        : o.item.id;
      lines.push(
        `| ${label} | ${o.item.expectedCategoryId} | ${o.categoryId} | ${o.confidence.toFixed(2)} | ${o.source} | ${o.needsReview ? 'yes' : 'no'} |`,
      );
    }
  }
  return lines.join('\n');
}
