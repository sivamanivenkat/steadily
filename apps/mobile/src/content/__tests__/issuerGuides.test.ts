import { ISSUER_IDS } from '@/data/issuers';

import { issuerGuides } from '../issuerGuides';

describe('issuer guides', () => {
  it('covers every issuer in the picker', () => {
    expect(Object.keys(issuerGuides.issuers).sort()).toEqual([...ISSUER_IDS].sort());
  });

  it('is marked unverified, with a TODO and steps for each issuer', () => {
    expect(issuerGuides.verified).toBe(false);
    for (const id of ISSUER_IDS) {
      const guide = issuerGuides.issuers[id];
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.todo.length).toBeGreaterThan(0);
      expect(['card', 'p2p']).toContain(guide.kind);
    }
  });
});
