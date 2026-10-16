/**
 * Glue between the Ask screen and the Ask engine (agent-core). Shared by the repo-backed and
 * synthetic data sources so both answer the same way.
 *
 * Privacy (D-011): the question text goes to the engine and to the screen, never into an event
 * or a log. Events carry ids and the `answeredBy` tag only.
 */
import { answerQuestion, type AskModel, type IdGenerator, type Repos } from '@steadily/agent-core';
import { createProxyAskModel } from '@steadily/proxy-core/client';
import type { NewEvent } from '@steadily/shared-types';

import { cloudEndpoint, getAccessToken } from './cloudSession';
import type { AskTurn, Settings } from './types';

export type AskRepos = Pick<Repos, 'transactions' | 'budgets' | 'subscriptions'>;

export type AskDeps = {
  repos: AskRepos;
  now: () => Date;
  newId: IdGenerator;
  /** Publishes events (ids only). Absent for sources without an event bus. */
  publish?: (events: NewEvent[]) => Promise<void>;
  /** Overrides the cloud model (tests). Called only when the user opted in. */
  cloudModel?: (endpoint: string) => AskModel | null;
};

/** IANA zone of the phone, falling back to UTC. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The cloud model exists only when the user opted in AND the build provides an endpoint.
 * Otherwise null: rules only, nothing leaves the phone.
 */
export function buildAskModel(
  settings: Settings,
  deps: Pick<AskDeps, 'cloudModel'>,
): AskModel | null {
  if (!settings.cloudAiOptIn) return null;
  const endpoint = cloudEndpoint();
  if (!endpoint) return null;
  if (deps.cloudModel) return deps.cloudModel(endpoint);
  return createProxyAskModel({
    endpoint,
    fetch: (input, init) => fetch(input, init),
    getAccessToken,
    isCloudEnabled: () => true,
  });
}

export async function runAsk(
  question: string,
  settings: Settings,
  deps: AskDeps,
): Promise<AskTurn> {
  const trimmed = question.trim();
  if (trimmed === '') throw new Error('Empty question');
  const id = deps.newId();
  await deps.publish?.([{ type: 'question.asked', payload: { questionId: id } }]);
  const model = buildAskModel(settings, deps);
  const answer = await answerQuestion({
    question: trimmed,
    repos: deps.repos,
    now: deps.now(),
    timeZone: deviceTimeZone(),
    model,
    privacy: model && model.source !== 'on_device_llm' ? 'cloud' : 'local',
  });
  await deps.publish?.([
    { type: 'question.answered', payload: { questionId: id, answeredBy: answer.answeredBy } },
  ]);
  return {
    id,
    question: trimmed,
    text: answer.text,
    answeredBy: answer.answeredBy,
    at: deps.now().toISOString(),
  };
}
