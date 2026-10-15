import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_PACKS,
  checkPortablePattern,
  cleanMerchant,
  directionFromText,
  Fixture,
  GENERIC_ISSUER_ID,
  parseAlert,
  parseAmountToMinor,
} from './index';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesDir = join(root, 'fixtures');
const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));

function loadFixtures(file: string): Fixture[] {
  const raw: unknown = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
  return Fixture.array().parse(raw);
}

describe('rule packs', () => {
  it('ship every required issuer plus the generic fallback last', () => {
    const ids = BUILT_IN_PACKS.map((p) => p.issuerId);
    expect(ids).toEqual([
      'chase',
      'capital_one',
      'amex',
      'citi',
      'discover',
      'bank_of_america',
      'venmo',
      'cash_app',
      GENERIC_ISSUER_ID,
    ]);
  });

  it('are unverified and file names match issuer ids', () => {
    const files = readdirSync(join(root, 'packs')).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual(BUILT_IN_PACKS.map((p) => `${p.issuerId}.json`).sort());
    for (const pack of BUILT_IN_PACKS) expect(pack.verified).toBe(false);
  });

  it('use unique rule ids', () => {
    const ids = BUILT_IN_PACKS.flatMap((p) => p.rules.map((r) => r.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('generic pack has only channel "any" rules and no sources', () => {
    const generic = BUILT_IN_PACKS.find((p) => p.issuerId === GENERIC_ISSUER_ID);
    expect(generic?.rules.every((r) => r.channel === 'any')).toBe(true);
    expect(generic?.sources).toEqual({ androidPackages: [], smsSenders: [] });
  });

  for (const pack of BUILT_IN_PACKS) {
    it(`${pack.issuerId}: every pattern stays in the portable regex subset`, () => {
      for (const rule of pack.rules) {
        expect(checkPortablePattern(rule.pattern, { requireAmount: true }), rule.id).toEqual([]);
      }
      for (const pattern of pack.exclude ?? []) {
        expect(checkPortablePattern(pattern), pattern).toEqual([]);
      }
    });
  }
});

describe('fixtures', () => {
  it('has a fixture file for every pack', () => {
    expect(fixtureFiles.sort()).toEqual(BUILT_IN_PACKS.map((p) => `${p.issuerId}.json`).sort());
  });

  for (const file of fixtureFiles) {
    const cases = loadFixtures(file);
    describe(file, () => {
      it('has at least 5 cases including positives and negatives', () => {
        expect(cases.length).toBeGreaterThanOrEqual(5);
        expect(cases.some((c) => c.expected === null)).toBe(true);
        expect(cases.some((c) => c.expected !== null)).toBe(true);
        expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length);
      });

      it('never contains long digit runs that could be card numbers', () => {
        for (const c of cases) expect(c.input.text).not.toMatch(/[0-9]{9,}/);
      });

      for (const c of cases) {
        it(c.name, () => {
          expect(parseAlert(c.input, BUILT_IN_PACKS)).toEqual(c.expected);
        });
      }
    });
  }
});

describe('parseAmountToMinor', () => {
  it.each([
    ['$1,234.56', 123456],
    ['$5', 500],
    ['USD 12.30', 1230],
    ['12.3', 1230],
    ['0.99', 99],
    ['1,000,000', 100000000],
  ])('%s -> %i', (raw, minor) => {
    expect(parseAmountToMinor(raw)).toBe(minor);
  });

  it.each(['', '$', '1.234', '12.3.4', 'abc'])('rejects %j', (raw) => {
    expect(parseAmountToMinor(raw)).toBeNull();
  });
});

describe('helpers', () => {
  it('cleans merchant text', () => {
    expect(cleanMerchant('  SQ *JOES   COFFEE. ')).toBe('SQ *JOES COFFEE');
    expect(cleanMerchant(' ., ')).toBeUndefined();
  });

  it('maps direction words with credit taking precedence', () => {
    expect(directionFromText('Refund', 'debit')).toBe('credit');
    expect(directionFromText('purchase', 'credit')).toBe('debit');
    expect(directionFromText('something', 'debit')).toBe('debit');
  });

  it('flags non-portable regex constructs', () => {
    expect(checkPortablePattern('(?<=x)(?<amount>[0-9]+)')).toContain('lookbehind is not allowed');
    expect(checkPortablePattern('(?<amount>\\d+)').length).toBeGreaterThan(0);
    expect(checkPortablePattern('(?<foo>[0-9]+)')).toContain('unknown group name: foo');
    expect(checkPortablePattern('(?<merchant>.+)', { requireAmount: true })).toContain(
      'missing amount group',
    );
  });

  it('uses the claimed pack first when the source is known', () => {
    const out = parseAlert(
      {
        text: 'Purchase of $4.50 at EXAMPLE CAFE',
        receivedAt: '2026-10-14T15:12:00.000Z',
        androidPackage: 'com.infonow.bofa',
      },
      BUILT_IN_PACKS,
    );
    expect(out?.issuerId).toBe('bank_of_america');
  });

  it('rejects inputs with an invalid receivedAt', () => {
    expect(() => parseAlert({ text: 'x', receivedAt: 'yesterday' }, BUILT_IN_PACKS)).toThrow();
  });
});
