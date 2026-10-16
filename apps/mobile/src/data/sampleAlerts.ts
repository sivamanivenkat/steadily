/**
 * Development only: the shared rule-pack fixtures (synthetic alerts, no real accounts) as
 * captures for the "Seed sample data" action. Loaded with `require` behind `__DEV__`, so release
 * bundles do not include it.
 */
import amex from '@steadily/rule-packs/fixtures/amex.json';
import bankOfAmerica from '@steadily/rule-packs/fixtures/bank_of_america.json';
import capitalOne from '@steadily/rule-packs/fixtures/capital_one.json';
import cashApp from '@steadily/rule-packs/fixtures/cash_app.json';
import chase from '@steadily/rule-packs/fixtures/chase.json';
import citi from '@steadily/rule-packs/fixtures/citi.json';
import discover from '@steadily/rule-packs/fixtures/discover.json';
import generic from '@steadily/rule-packs/fixtures/generic.json';
import venmo from '@steadily/rule-packs/fixtures/venmo.json';
import { CaptureSource } from '@steadily/shared-types';

import { spreadOverMonth, type AlertCapture } from './repoDataSource';

type FixtureCase = {
  input: { text: string; source?: string; androidPackage?: string; smsSender?: string };
  expected: unknown;
};

const ALL: readonly FixtureCase[] = [
  chase,
  amex,
  capitalOne,
  citi,
  discover,
  bankOfAmerica,
  venmo,
  cashApp,
  generic,
].flat();

/** Fixtures that parse to a transaction, dated across the current month up to `now`. */
export function sampleAlerts(now: Date): AlertCapture[] {
  const alerts = ALL.filter((c) => c.expected !== null).map((c): AlertCapture => {
    const source = CaptureSource.safeParse(c.input.source);
    return {
      text: c.input.text,
      source: source.success ? source.data : 'android_notification',
      ...(c.input.androidPackage ? { androidPackage: c.input.androidPackage } : {}),
      ...(c.input.smsSender ? { smsSender: c.input.smsSender } : {}),
    };
  });
  return spreadOverMonth(alerts, now);
}
