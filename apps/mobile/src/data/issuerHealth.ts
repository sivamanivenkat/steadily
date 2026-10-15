import type { IssuerHealth, IssuerSetup } from './types';

/** An issuer counts as quiet after this long without an alert (D-014). */
export const QUIET_AFTER_DAYS = 7;

export function issuerHealth(setup: IssuerSetup, now: Date): IssuerHealth {
  if (setup.lastAlertAt !== null) {
    const ageMs = now.getTime() - new Date(setup.lastAlertAt).getTime();
    return ageMs <= QUIET_AFTER_DAYS * 86_400_000 ? 'receiving' : 'quiet';
  }
  return setup.setupStatus === 'done' ? 'waiting' : 'not_set_up';
}

export const ISSUER_HEALTH_LABEL: Record<IssuerHealth, string> = {
  receiving: 'Receiving alerts',
  quiet: 'No alerts in 7 days',
  waiting: 'Waiting for first alert',
  not_set_up: 'Not set up',
};
