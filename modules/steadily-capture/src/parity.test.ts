import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DICTIONARY, lookupMerchant, normalizeMerchant } from '@steadily/merchants';
import { BUILT_IN_PACKS } from '@steadily/rule-packs';

/**
 * Keeps the Kotlin fast path honest. The TypeScript merchant normalizer is the reference; its
 * output for a fixed corpus is stored in the golden file that the Kotlin tests replay.
 * Regenerate after changing normalization or the dictionary:
 *   UPDATE_GOLDEN=1 pnpm --filter steadily-capture test
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const GOLDEN = join(here, '../android/src/test/resources/merchant-golden.json');
const KOTLIN_ENGINE = join(
  here,
  '../android/src/main/java/expo/modules/steadilycapture/fastpath/CaptureEngine.kt',
);
const KOTLIN_TEXT = join(
  here,
  '../android/src/main/java/expo/modules/steadilycapture/CaptureText.kt',
);
const TAXONOMY = join(root, 'packages/taxonomy/src/index.ts');

type Case = { raw: string; name: string; key: string; categoryId: string | null; multi: boolean };

/** Hand-picked descriptors (mirroring packages/merchants tests) plus every fixture and entry. */
function corpus(): string[] {
  const raws = new Set<string>([
    '   ',
    'SQ *BLUE BOTTLE COFFEE',
    'SQ*JOES COFFEE',
    '  sq *  sunrise   cafe ',
    'TST* JOES DINER',
    'PAYPAL *EXAMPLESHOP',
    'PP*GREENLEAF GOODS',
    'DD *CHIPOTLE 1234',
    'DOORDASH*SHAKE SHACK',
    'GOOGLE *YOUTUBEPREMIUM',
    'UBER *TRIP',
    'UBER* TRIP HELP.UBER.COM',
    'UBER *EATS',
    'AMZN Mktp US*2K4AB1C23',
    'Amazon.com*AB12CD34',
    'AMAZON PRIME*1A2B3C',
    'APPLE.COM/BILL CUPERTINO CA',
    'Apple.com/bill 866-712-7753',
    'APPLE STORE #R123',
    'UNITED 0162345678901 HOUSTON TX',
    'JETBLUE 2792345678901',
    'UNITED HEALTHCARE',
    'SOUTHWEST GAS',
    'STARBUCKS STORE 12345 SEATTLE WA',
    'WALGREENS #1234',
    'BP#1234567',
    'CVS/PHARMACY #01234',
    'TARGET T-1234',
    'COSTCO WHSE #0123',
    'WAL-MART #1234',
    'NETFLIX.COM',
    'SPOTIFY*P1234ABCD',
    'HULU 800-555-0100',
    'BESTBUY.COM 00012345',
    "MCDONALD'S F12345",
    'Chick-fil-A #01234',
    'DUNKIN #345678',
    'KFC 123',
    'AT&T*BILL PAYMENT',
    'TRADER JOE S #552',
    'WHOLEFDS MKT 10234',
    'SHELL OIL 57444 HOUSTON TX',
    'JOES PIZZA AUSTIN TX',
    'GREEN LEAF CAFE SAN FRANCISCO CA',
    'ACME PIZZA CO',
    'CORNER BAKERY LLC',
    'LOCAL BAR AND GRILL',
    'MARIA S TACOS',
    '7-ELEVEN 12345',
    'Café Rio',
    'Sam Example',
    'ALEX M.',
  ]);
  const fixtureDir = join(root, 'packages/rule-packs/fixtures');
  for (const file of readdirSync(fixtureDir)) {
    const cases = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8')) as {
      expected: { merchantRaw?: string } | null;
    }[];
    for (const c of cases) if (c.expected?.merchantRaw) raws.add(c.expected.merchantRaw);
  }
  for (const m of DICTIONARY.merchants) {
    raws.add(m.name);
    raws.add(m.name.toUpperCase());
    for (const alias of m.aliases ?? []) raws.add(alias.replace(/_/g, ' ').toUpperCase());
  }
  return [...raws];
}

function build(): Case[] {
  return corpus().map((raw) => {
    const n = normalizeMerchant(raw);
    const entry = lookupMerchant(n.key);
    return {
      raw,
      name: n.name,
      key: n.key,
      categoryId: entry?.categoryId ?? null,
      multi: entry?.multiCategory === true,
    };
  });
}

describe('merchant normalizer golden file', () => {
  it('matches the TypeScript reference', () => {
    const cases = build();
    if (process.env.UPDATE_GOLDEN === '1') {
      const lines = cases.map((c) => JSON.stringify(c));
      writeFileSync(GOLDEN, `[\n${lines.join(',\n')}\n]\n`);
    }
    expect(JSON.parse(readFileSync(GOLDEN, 'utf8'))).toEqual(cases);
  });
});

describe('Kotlin bundle order', () => {
  it('lists the packs in the same order as BUILT_IN_PACKS', () => {
    const src = readFileSync(KOTLIN_ENGINE, 'utf8');
    const block = /BUNDLE_ORDER\s*=\s*listOf\(([^)]*)\)/.exec(src)?.[1] ?? '';
    const kotlin = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
    expect(kotlin).toEqual(BUILT_IN_PACKS.map((p) => p.issuerId));
  });
});

describe('Kotlin category labels', () => {
  it('match packages/taxonomy exactly and in order', async () => {
    const { CATEGORIES } = (await import(pathToFileURL(TAXONOMY).href)) as {
      CATEGORIES: readonly { id: string; name: string }[];
    };
    const src = readFileSync(KOTLIN_TEXT, 'utf8');
    const block = /BY_ID[^=]*=\s*linkedMapOf\(([^)]*)\)/.exec(src)?.[1] ?? '';
    const kotlin = [...block.matchAll(/"([^"]+)" to "([^"]+)"/g)].map((m) => [m[1], m[2]]);
    expect(kotlin).toEqual(CATEGORIES.map((c) => [c.id, c.name]));
  });
});

describe('Headless JS task name', () => {
  it('is the same in Kotlin and TypeScript', () => {
    const kotlin = readFileSync(
      join(here, '../android/src/main/java/expo/modules/steadilycapture/CaptureDrainService.kt'),
      'utf8',
    );
    const ts = readFileSync(join(here, 'index.ts'), 'utf8');
    const k = /TASK_NAME\s*=\s*"([^"]+)"/.exec(kotlin)?.[1];
    const t = /CAPTURE_DRAIN_TASK\s*=\s*'([^']+)'/.exec(ts)?.[1];
    expect(k).toBe('SteadilyCaptureDrain');
    expect(t).toBe(k);
  });
});
