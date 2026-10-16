import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { BUILT_IN_PACKS, Fixture, parseAlert, type RulePack } from '@steadily/rule-packs';
import { EVALS_ROOT } from './dataset';

export const FIXTURES_DIR = join(EVALS_ROOT, '..', 'packages', 'rule-packs', 'fixtures');

export interface IssuerParserStats {
  /** Fixture file name without `.json`. */
  issuer: string;
  cases: number;
  positives: number;
  amountCorrect: number;
  merchantCorrect: number;
  negatives: number;
  /** Negatives (OTP, promo, decline...) that correctly produced nothing. */
  negativesRejected: number;
  /** Cases whose whole result equals the fixture. */
  exact: number;
  failures: string[];
}

export interface ParserReport {
  issuers: IssuerParserStats[];
  totals: Omit<IssuerParserStats, 'issuer' | 'failures'>;
  amountAccuracy: number;
  merchantAccuracy: number;
  negativeAccuracy: number;
  exactAccuracy: number;
}

export function loadFixtureFiles(dir = FIXTURES_DIR): { issuer: string; cases: Fixture[] }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({
      issuer: f.replace(/\.json$/, ''),
      cases: Fixture.array().parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))),
    }));
}

/** Runs every shared rule-pack fixture through the TypeScript reference parser. */
export function runParserEval(
  files = loadFixtureFiles(),
  packs: readonly RulePack[] = BUILT_IN_PACKS,
): ParserReport {
  const issuers = files.map(({ issuer, cases }): IssuerParserStats => {
    const s: IssuerParserStats = {
      issuer,
      cases: cases.length,
      positives: 0,
      amountCorrect: 0,
      merchantCorrect: 0,
      negatives: 0,
      negativesRejected: 0,
      exact: 0,
      failures: [],
    };
    for (const c of cases) {
      const got = parseAlert(c.input, packs);
      const exact = isDeepStrictEqual(got, c.expected);
      if (exact) s.exact++;
      else s.failures.push(c.name);
      if (c.expected === null) {
        s.negatives++;
        if (got === null) s.negativesRejected++;
        continue;
      }
      s.positives++;
      if (got?.amountMinor === c.expected.amountMinor) s.amountCorrect++;
      if (got !== null && got.merchantRaw === c.expected.merchantRaw) s.merchantCorrect++;
    }
    return s;
  });

  const sum = (k: keyof Omit<IssuerParserStats, 'issuer' | 'failures'>) =>
    issuers.reduce((n, s) => n + s[k], 0);
  const totals = {
    cases: sum('cases'),
    positives: sum('positives'),
    amountCorrect: sum('amountCorrect'),
    merchantCorrect: sum('merchantCorrect'),
    negatives: sum('negatives'),
    negativesRejected: sum('negativesRejected'),
    exact: sum('exact'),
  };
  const r = (n: number, d: number) => (d === 0 ? 1 : n / d);
  return {
    issuers,
    totals,
    amountAccuracy: r(totals.amountCorrect, totals.positives),
    merchantAccuracy: r(totals.merchantCorrect, totals.positives),
    negativeAccuracy: r(totals.negativesRejected, totals.negatives),
    exactAccuracy: r(totals.exact, totals.cases),
  };
}
