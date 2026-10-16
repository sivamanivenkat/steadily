// Prints the eval report as markdown: `pnpm --filter @steadily/evals eval [dataset.json ...]`.
// Without arguments it runs the synthetic set plus any local `data/*.real.json` sets.
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { runCategorizeEval } from './categorize';
import { DATA_DIR, loadDataset, SYNTHETIC_DATASET } from './dataset';
import { runParserEval } from './parser';
import { categorizeMarkdown, parserMarkdown } from './report';

async function main() {
  const args = process.argv.slice(2);
  const datasets =
    args.length > 0
      ? args.map((a) => resolve(a))
      : [
          SYNTHETIC_DATASET,
          ...readdirSync(DATA_DIR)
            .filter((f) => f.endsWith('.real.json'))
            .map((f) => join(DATA_DIR, f)),
        ];

  const sections = ['# Steadily eval report', '', parserMarkdown(runParserEval())];
  for (const path of datasets) {
    const report = await runCategorizeEval(loadDataset(path).items);
    const real = path.endsWith('.real.json');
    sections.push('', categorizeMarkdown(report, { title: basename(path), showMerchants: !real }));
  }
  process.stdout.write(sections.join('\n') + '\n');
}

main().catch((error: unknown) => {
  process.stderr.write(`eval failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exitCode = 1;
});
