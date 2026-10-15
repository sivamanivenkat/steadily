import type { Agent } from '@steadily/shared-types';
import type { Repos } from '../ports';

export const HOUSEKEEPING_AGENT_NAME = 'housekeeping';

export interface HousekeepingAgentDeps {
  repos: Pick<Repos, 'inbox'>;
}

/**
 * Housekeeping: periodic clean-up with no event subscriptions. Its tick deletes
 * inbox items past `expiresAt`, so raw alert text that was never parsed (app
 * killed, parser failing) doesn't outlive its retention window (D-011).
 * Logs only the count.
 */
export function createHousekeepingAgent(deps: HousekeepingAgentDeps): Agent {
  return {
    name: HOUSEKEEPING_AGENT_NAME,
    subscribes: [],
    async handle() {
      return [];
    },
    async tick(ctx) {
      const removed = await deps.repos.inbox.purgeExpired(ctx.now().toISOString());
      if (removed > 0) {
        ctx.log.info(`Purged ${removed} expired inbox item(s)`, {
          agent: HOUSEKEEPING_AGENT_NAME,
        });
      }
      return [];
    },
  };
}
