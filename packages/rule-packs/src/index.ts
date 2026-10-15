import { RulePack } from './schema';
import amex from '../packs/amex.json';
import bankOfAmerica from '../packs/bank_of_america.json';
import capitalOne from '../packs/capital_one.json';
import cashApp from '../packs/cash_app.json';
import chase from '../packs/chase.json';
import citi from '../packs/citi.json';
import discover from '../packs/discover.json';
import generic from '../packs/generic.json';
import venmo from '../packs/venmo.json';

export * from './schema';
export * from './parse';
export { checkPortablePattern } from './portability';

/** All bundled packs, validated at load. The generic fallback is last. */
export const BUILT_IN_PACKS: readonly RulePack[] = [
  chase,
  capitalOne,
  amex,
  citi,
  discover,
  bankOfAmerica,
  venmo,
  cashApp,
  generic,
].map((p) => RulePack.parse(p));

export function getPack(issuerId: string): RulePack | undefined {
  return BUILT_IN_PACKS.find((p) => p.issuerId === issuerId);
}
