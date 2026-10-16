import { describe, expect, it } from 'vitest';
import { createCapturingLogger } from '../testing';
import {
  answerQuestion,
  MAX_ASK_STEPS,
  type AskModel,
  type AskStep,
  type AskToolResult,
} from './ask';
import { jsonBytes } from './tools';
import { NOW, NY, PERSON_NAME, SECRET_NOTE, seedRepos, budget } from './fixtures';

const month = { kind: 'month', offset: 0 };

/** A scripted model that records everything it is shown. */
function scripted(steps: (AskStep | Error)[], source?: AskModel['source']) {
  const seen: { question: string; toolResults: AskToolResult[]; toolNames: string[] }[] = [];
  let i = 0;
  const model: AskModel = {
    ...(source ? { source } : {}),
    async step(input) {
      seen.push(
        JSON.parse(
          JSON.stringify({
            question: input.question,
            toolResults: input.toolResults,
            toolNames: input.tools.map((t) => t.name),
          }),
        ),
      );
      const next = steps[Math.min(i++, steps.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { model, seen };
}

const base = () => ({
  repos: seedRepos(),
  now: NOW,
  timeZone: NY,
  privacy: 'cloud' as const,
});

describe('answerQuestion with a model', () => {
  it('runs tools on the device and returns the model answer', async () => {
    const { model, seen } = scripted([
      {
        kind: 'tool_calls',
        calls: [{ id: 'c1', name: 'spending_total', input: { period: month } }],
      },
      { kind: 'answer', text: 'You have spent about $296 this month.' },
    ]);
    const answer = await answerQuestion({ ...base(), question: 'How is my month going?', model });
    expect(answer).toEqual({
      text: 'You have spent about $296 this month.',
      answeredBy: 'cloud_llm',
      steps: 2,
    });
    expect(seen[0]!.toolResults).toEqual([]);
    expect(seen[0]!.toolNames).toHaveLength(6);
    expect(seen[1]!.toolResults).toEqual([
      {
        id: 'c1',
        name: 'spending_total',
        input: { period: month },
        output: {
          period: { label: 'October 2026', from: '2026-10-01', to: '2026-11-01' },
          currency: 'USD',
          totalMinor: 29599,
          transactionCount: 7,
        },
      },
    ]);
  });

  it('reports on_device_llm for an on-device model', async () => {
    const { model } = scripted([{ kind: 'answer', text: 'ok' }], 'on_device_llm');
    const answer = await answerQuestion({ ...base(), privacy: 'local', question: 'hi', model });
    expect(answer.answeredBy).toBe('on_device_llm');
  });

  it('returns invalid tool input to the model as an error result and lets it retry', async () => {
    const { model, seen } = scripted([
      {
        kind: 'tool_calls',
        calls: [{ id: 'a', name: 'top_merchants', input: { period: month, limit: 99 } }],
      },
      { kind: 'answer', text: 'done' },
    ]);
    const answer = await answerQuestion({ ...base(), question: 'q', model });
    expect(answer.text).toBe('done');
    expect(seen[1]!.toolResults[0]!.output).toEqual({ error: 'invalid_input' });
  });

  it('rejects undeclared tools and falls back to rules', async () => {
    const { model } = scripted([
      { kind: 'tool_calls', calls: [{ id: 'x', name: 'delete_all', input: {} }] },
    ]);
    const logger = createCapturingLogger();
    const answer = await answerQuestion({
      ...base(),
      question: 'how much did I spend this month',
      model,
      logger,
    });
    expect(answer.answeredBy).toBe('rules');
    expect(answer.text).toBe("So far this month you've spent $295.99.");
    expect(logger.entries.map((e) => e.message)).toEqual(['ask.model_protocol']);
  });

  it('stops after the step limit and falls back to rules', async () => {
    const loop: AskStep = {
      kind: 'tool_calls',
      calls: [{ id: 'same', name: 'budget_status', input: {} }],
    };
    const { model, seen } = scripted([loop]);
    const answer = await answerQuestion({
      ...base(),
      question: 'how much did I spend this month',
      model,
    });
    expect(seen).toHaveLength(MAX_ASK_STEPS);
    expect(answer.answeredBy).toBe('rules');
    expect(answer.steps).toBe(MAX_ASK_STEPS);
    // Repeated call ids from the model are made unique.
    const ids = seen[MAX_ASK_STEPS - 1]!.toolResults.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to rules when the model throws', async () => {
    const { model } = scripted([new Error('network down: how much 12.34 at Jane Quill')]);
    const logger = createCapturingLogger();
    const answer = await answerQuestion({
      ...base(),
      question: 'How much did I spend last month?',
      model,
      logger,
    });
    expect(answer).toEqual({
      text: 'You spent $250.00 last month.',
      answeredBy: 'rules',
      steps: 1,
    });
    expect(logger.entries).toEqual([{ level: 'warn', message: 'ask.model_failed' }]);
  });

  it('falls back when the model returns null or an empty answer', async () => {
    const nullModel: AskModel = { step: async () => null };
    expect(
      (await answerQuestion({ ...base(), question: 'hello', model: nullModel })).answeredBy,
    ).toBe('rules');
    const { model } = scripted([{ kind: 'answer', text: '   ' }]);
    expect((await answerQuestion({ ...base(), question: 'hello', model })).answeredBy).toBe(
      'rules',
    );
  });

  it('keeps tool results under the proxy cap', async () => {
    const calls = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      name: 'compare_periods',
      input: { periodA: month, periodB: { kind: 'month', offset: -1 } },
    }));
    const { model, seen } = scripted([{ kind: 'tool_calls', calls }]);
    await answerQuestion({ ...base(), question: 'q', model });
    for (const s of seen) expect(jsonBytes(s.toolResults)).toBeLessThanOrEqual(16 * 1024);
  });

  it('forces cloud-safe results for a cloud model even if the caller says local', async () => {
    const { model, seen } = scripted([
      {
        kind: 'tool_calls',
        calls: [{ id: 'c', name: 'top_merchants', input: { period: month, limit: 10 } }],
      },
      { kind: 'answer', text: 'ok' },
    ]);
    await answerQuestion({ ...base(), privacy: 'local', question: 'q', model });
    expect(JSON.stringify(seen[1]!.toolResults)).not.toContain(PERSON_NAME);
  });

  it('truncates the question to the proxy limit', async () => {
    const { model, seen } = scripted([{ kind: 'answer', text: 'ok' }]);
    await answerQuestion({ ...base(), question: 'x'.repeat(900), model });
    expect(seen[0]!.question).toHaveLength(500);
  });
});

describe('privacy: what leaves the device', () => {
  it('shows only aggregates in a full cloud transcript', async () => {
    const repos = seedRepos();
    const b = budget({ categoryId: null });
    repos.budgets.rows.set(b.id, b);
    const { model, seen } = scripted([
      {
        kind: 'tool_calls',
        calls: [
          { id: 'a', name: 'spending_total', input: { period: month } },
          { id: 'b', name: 'spending_by_category', input: { period: month } },
          { id: 'c', name: 'top_merchants', input: { period: month, limit: 10 } },
          { id: 'd', name: 'budget_status', input: {} },
        ],
      },
      { kind: 'answer', text: 'ok' },
    ]);
    await answerQuestion({ ...base(), repos, question: 'Where did my money go?', model });
    const transcript = JSON.stringify(seen);
    for (const forbidden of [
      PERSON_NAME,
      'Jane',
      SECRET_NOTE,
      'VENMO',
      '4242',
      'merchantRaw',
      'accountLast4',
      'txnRef',
      'occurredAt',
      '20000000-0000',
    ]) {
      expect(transcript).not.toContain(forbidden);
    }
    expect(transcript).toContain('Payments to people');
  });

  it('logs no question text, amounts or names, on any path', async () => {
    const logger = createCapturingLogger();
    const question = 'How much did I spend at Jane Quill 25.00?';
    await answerQuestion({ ...base(), question, logger }); // rules
    const { model } = scripted([new Error(`boom ${question}`)]);
    await answerQuestion({ ...base(), question, model, logger });
    const { model: loopModel } = scripted([
      { kind: 'tool_calls', calls: [{ id: 'z', name: 'nope', input: {} }] },
    ]);
    await answerQuestion({ ...base(), question, model: loopModel, logger });
    const logged = JSON.stringify(logger.entries);
    for (const secret of ['Jane', 'Quill', '25.00', 'spend', '295', 'Trader']) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('answerQuestion without a model', () => {
  it('uses rules', async () => {
    const answer = await answerQuestion({
      ...base(),
      privacy: 'local',
      question: 'How much did I spend on groceries this month?',
    });
    expect(answer).toEqual({
      text: "So far this month you've spent $200.00 on Groceries.",
      answeredBy: 'rules',
      steps: 0,
    });
  });

  it('lists what it can answer for unknown questions', async () => {
    const answer = await answerQuestion({ ...base(), question: 'what is the meaning of life' });
    expect(answer.text).toContain('I can answer questions about your spending');
  });
});
