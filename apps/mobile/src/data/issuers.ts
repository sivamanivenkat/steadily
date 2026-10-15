/**
 * Banks, card issuers and payment apps offered in onboarding (D-014). Ids match rule-pack issuer
 * ids. Text tiles only: no logos until we have the rights to use them.
 */
export const ISSUERS = [
  { id: 'chase', name: 'Chase' },
  { id: 'amex', name: 'Amex' },
  { id: 'capital_one', name: 'Capital One' },
  { id: 'citi', name: 'Citi' },
  { id: 'discover', name: 'Discover' },
  { id: 'bank_of_america', name: 'Bank of America' },
  { id: 'wells_fargo', name: 'Wells Fargo' },
  { id: 'us_bank', name: 'US Bank' },
  { id: 'apple_card', name: 'Apple Card' },
  { id: 'venmo', name: 'Venmo' },
  { id: 'cash_app', name: 'Cash App' },
  { id: 'other', name: 'Other' },
] as const;

export type IssuerId = (typeof ISSUERS)[number]['id'];

export const ISSUER_IDS: readonly IssuerId[] = ISSUERS.map((i) => i.id);

export function isIssuerId(value: string): value is IssuerId {
  return (ISSUER_IDS as readonly string[]).includes(value);
}

/** Display name for any issuer id, including ones outside the picker (e.g. "zelle"). */
export function issuerName(id: string | null): string | null {
  if (id === null) return null;
  const known = ISSUERS.find((i) => i.id === id);
  if (known) return known.name;
  if (id === 'zelle') return 'Zelle';
  return id;
}

/** Payment apps where the other side is a person, so the review card asks what it was for. */
const P2P_ISSUERS = new Set(['venmo', 'zelle', 'cash_app']);

export function isP2PIssuer(id: string | null): boolean {
  return id !== null && P2P_ISSUERS.has(id);
}
