import type { IssuerId } from '@/data/issuers';

import guides from './issuer-guides.json';

export type IssuerGuide = {
  kind: 'card' | 'p2p';
  /** Note for whoever verifies the guide. Not shown to users. */
  todo: string;
  steps: string[];
};

type GuideFile = {
  version: number;
  /** False until every menu path has been checked on a real device. */
  verified: boolean;
  issuers: Record<IssuerId, IssuerGuide>;
};

/**
 * Local copy of the issuer alert guides (D-014). Will be replaced by content fetched from
 * Supabase; until then the app shows a "general steps" note because `verified` is false.
 */
export const issuerGuides: GuideFile = guides as GuideFile;

export function guideFor(id: IssuerId): IssuerGuide {
  return issuerGuides.issuers[id];
}
