/**
 * "Ask your money" engine: a bounded tool-using loop over an optional model,
 * with a rules-based answerer when there is no model or it fails.
 *
 * Privacy: tools run here, on the device. Only their results (aggregates in
 * cloud mode, see tools.ts) are handed to the model. Nothing in this file logs
 * question text, amounts or merchant names.
 */
import type { AgentLogger } from '@steadily/shared-types';
import type { Repos } from '../ports';
import { answerWithRules } from './rules';
import {
  ASK_TOOLS,
  executeTool,
  jsonBytes,
  type AskPrivacy,
  type AskToolDefinition,
  type ToolContext,
} from './tools';

export const MAX_ASK_STEPS = 5;
const MAX_CALLS_PER_STEP = 4;
const MAX_TOOL_RESULTS = 24;
/** Stay under the proxy's 16 KB toolResults cap. */
const MAX_TOOL_RESULTS_BYTES = 15 * 1024;
const MAX_QUESTION_CHARS = 500;

/** Structurally identical to the proxy `ask` contract (packages/proxy-core). */
export interface AskToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface AskToolResult {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: unknown;
}
export type AskStep =
  { kind: 'tool_calls'; calls: AskToolCall[] } | { kind: 'answer'; text: string };

export interface AskModel {
  /** Which answeredBy value a model-written answer is reported as. Default 'cloud_llm'. */
  readonly source?: 'cloud_llm' | 'on_device_llm';
  step(input: {
    question: string;
    tools: AskToolDefinition[];
    toolResults: AskToolResult[];
  }): Promise<AskStep | null>;
}

export interface AskAnswer {
  text: string;
  answeredBy: 'cloud_llm' | 'on_device_llm' | 'rules';
  /** Model steps taken (0 for rules). */
  steps: number;
}

export interface AnswerQuestionInput {
  question: string;
  repos: Pick<Repos, 'transactions' | 'budgets' | 'subscriptions'>;
  now: Date;
  timeZone: string;
  model?: AskModel | null;
  privacy: AskPrivacy;
  currency?: string;
  logger?: AgentLogger;
}

const IDENTIFIER = /^[a-zA-Z0-9_-]{1,64}$/;

class ModelProtocolError extends Error {}

export async function answerQuestion(input: AnswerQuestionInput): Promise<AskAnswer> {
  const { model, logger } = input;
  // A cloud model only ever gets cloud-safe (aggregate) results, whatever the caller passed.
  const source = model?.source ?? 'cloud_llm';
  const privacy: AskPrivacy = model && source === 'cloud_llm' ? 'cloud' : input.privacy;
  const ctx: ToolContext = {
    repos: input.repos,
    now: input.now,
    timeZone: input.timeZone,
    privacy,
    ...(input.currency !== undefined ? { currency: input.currency } : {}),
  };

  const fallback = async (steps: number): Promise<AskAnswer> => ({
    text: await answerWithRules(input.question, ctx),
    answeredBy: 'rules',
    steps,
  });

  if (!model) return fallback(0);

  const question = input.question.trim().slice(0, MAX_QUESTION_CHARS);
  const toolResults: AskToolResult[] = [];
  const seenIds = new Set<string>();
  let steps = 0;
  try {
    while (steps < MAX_ASK_STEPS) {
      steps += 1;
      const step = await model.step({
        question,
        tools: ASK_TOOLS.map((t) => ({ ...t })),
        toolResults: toolResults.map((r) => ({ ...r })),
      });
      if (!step) throw new ModelProtocolError('no step');
      if (step.kind === 'answer') {
        const text = typeof step.text === 'string' ? step.text.trim() : '';
        if (!text) throw new ModelProtocolError('empty answer');
        return { text, answeredBy: source, steps };
      }
      if (step.kind !== 'tool_calls' || !Array.isArray(step.calls) || step.calls.length === 0) {
        throw new ModelProtocolError('bad step');
      }
      for (const call of step.calls.slice(0, MAX_CALLS_PER_STEP)) {
        if (!ASK_TOOLS.some((t) => t.name === call.name)) {
          throw new ModelProtocolError('undeclared tool');
        }
        let id = typeof call.id === 'string' && IDENTIFIER.test(call.id) ? call.id : '';
        if (!id || seenIds.has(id)) id = `call_${seenIds.size + 1}_${steps}`;
        seenIds.add(id);
        const callInput =
          call.input && typeof call.input === 'object' && !Array.isArray(call.input)
            ? call.input
            : {};
        const outcome = await executeTool(call.name, callInput, ctx);
        const result: AskToolResult = {
          id,
          name: call.name,
          input: callInput,
          output: outcome.ok ? outcome.output : { error: outcome.error },
        };
        if (
          toolResults.length >= MAX_TOOL_RESULTS ||
          jsonBytes([...toolResults, result]) > MAX_TOOL_RESULTS_BYTES
        ) {
          throw new ModelProtocolError('tool results too large');
        }
        toolResults.push(result);
      }
    }
    logger?.warn('ask.step_limit');
  } catch (error) {
    // Only the error kind is logged; messages could carry model or user text.
    logger?.warn(error instanceof ModelProtocolError ? 'ask.model_protocol' : 'ask.model_failed');
  }
  return fallback(steps);
}
