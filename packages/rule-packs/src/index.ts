import { RulePack } from './schema';
import amex from '../packs/amex.json';
import appleCard from '../packs/apple_card.json';
import bankOfAmerica from '../packs/bank_of_america.json';
import capitalOne from '../packs/capital_one.json';
import cashApp from '../packs/cash_app.json';
import chase from '../packs/chase.json';
import citi from '../packs/citi.json';
import discover from '../packs/discover.json';
import generic from '../packs/generic.json';
import paypal from '../packs/paypal.json';
import usBank from '../packs/us_bank.json';
import venmo from '../packs/venmo.json';
import wellsFargo from '../packs/wells_fargo.json';
import zelle from '../packs/zelle.json';

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
  wellsFargo,
  usBank,
  appleCard,
  venmo,
  cashApp,
  zelle,
  paypal,
  generic,
].map((p) => RulePack.parse(p));

export function getPack(issuerId: string): RulePack | undefined {
  return BUILT_IN_PACKS.find((p) => p.issuerId === issuerId);
}
