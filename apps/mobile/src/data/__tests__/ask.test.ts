import type { AskModel } from '@steadily/agent-core';
import { events } from '@steadily/db';
import { createTestDb } from '@steadily/db/node';
import { EventPayloads } from '@steadily/shared-types';

import { createRepoDataSource, type AlertCapture } from '../repoDataSource';
import { createAppLogger, createAppRuntime } from '../runtime';
import { createSyntheticDataSource } from '../synthetic';
import type { DataSource } from '../DataSource';

/** Thursday, October 15 2026, 9:30 AM local time. */
const NOW = new Date(2026, 9, 15, 9, 30);
const newId = () => globalThis.crypto.randomUUID();

const COFFEE: AlertCapture = {
  text: 'You made a $5 transaction with SQ *BLUE BOTTLE COFFEE on your card ending in 1234',
  source: 'android_notification',
  androidPackage: 'com.chase.sig.android',
  occurredAt: new Date(2026, 9, 12, 12).toISOString(),
};

const QUESTION = 'How much did I spend this month?';
const PROXY_ENV = 'EXPO_PUBLIC_CLAUDE_PROXY_URL';

function launch(cloudModel?: (endpoint: string) => AskModel | null) {
  const { db } = createTestDb();
  const app = createAppRuntime(db, { newId, clock: () => NOW, log: createAppLogger(false) });
  const source = createRepoDataSource({
    db,
    ...app,
    newId,
    now: () => NOW,
    ...(cloudModel ? { cloudModel } : {}),
  });
  return { db, source };
}

describe('DataSource.ask (repo source)', () => {
  const saved = process.env[PROXY_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[PROXY_ENV];
    else process.env[PROXY_ENV] = saved;
  });

  it('answers from the real database with the rules answerer', async () => {
    const { source } = launch();
    await source.captureAlerts([COFFEE]);

    const turn = await source.ask!(QUESTION);
    expect(turn.answeredBy).toBe('rules');
    expect(turn.question).toBe(QUESTION);
    expect(turn.text).toContain('$5.00');
    expect(turn.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(turn.at).toBe(NOW.toISOString());
  });

  it('publishes ids only: the question text never reaches an event', async () => {
    const { source, db } = launch();
    await source.captureAlerts([COFFEE]);
    const turn = await source.ask!(QUESTION);

    const rows = db.select().from(events).all();
    const asked = rows.filter((r) => r.type === 'question.asked');
    const answered = rows.filter((r) => r.type === 'question.answered');
    expect(asked).toHaveLength(1);
    expect(answered).toHaveLength(1);
    expect(EventPayloads['question.asked'].parse(asked[0]!.payload)).toEqual({
      questionId: turn.id,
    });
    expect(EventPayloads['question.answered'].parse(answered[0]!.payload)).toEqual({
      questionId: turn.id,
      answeredBy: 'rules',
    });
    expect(JSON.stringify(rows)).not.toContain('spend this month');
    expect(JSON.stringify(rows)).not.toContain(turn.text);
  });

  it('stays rules-only when cloud AI is off, even with an endpoint configured', async () => {
    process.env[PROXY_ENV] = 'https://proxy.example.test/ask';
    const model = jest.fn(() => ({ source: 'cloud_llm' as const, step: jest.fn() }));
    const { source } = launch(model);
    await source.ask!(QUESTION);
    expect(model).not.toHaveBeenCalled();
  });

  it('stays rules-only when cloud AI is on but the build has no endpoint', async () => {
    delete process.env[PROXY_ENV];
    const model = jest.fn(() => ({ source: 'cloud_llm' as const, step: jest.fn() }));
    const { source } = launch(model);
    await source.updateSettings({ cloudAiOptIn: true });
    const turn = await source.ask!(QUESTION);
    expect(model).not.toHaveBeenCalled();
    expect(turn.answeredBy).toBe('rules');
  });

  it('uses the cloud model only when opted in and configured', async () => {
    process.env[PROXY_ENV] = 'https://proxy.example.test/ask';
    const step = jest.fn(async () => ({ kind: 'answer' as const, text: 'You spent about $5.' }));
    const model = jest.fn(() => ({ source: 'cloud_llm' as const, step }));
    const { source, db } = launch(model);
    await source.updateSettings({ cloudAiOptIn: true });

    const turn = await source.ask!(QUESTION);
    expect(model).toHaveBeenCalledWith('https://proxy.example.test/ask');
    expect(turn).toMatchObject({ answeredBy: 'cloud_llm', text: 'You spent about $5.' });
    const answered = db
      .select()
      .from(events)
      .all()
      .filter((r) => r.type === 'question.answered');
    expect(answered[0]!.payload).toMatchObject({ answeredBy: 'cloud_llm' });
  });

  it('falls back to rules while the cloud session seam is inert (no token)', async () => {
    process.env[PROXY_ENV] = 'https://proxy.example.test/ask';
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const { source } = launch(); // real proxy model, getAccessToken returns null
    await source.updateSettings({ cloudAiOptIn: true });
    const turn = await source.ask!(QUESTION);
    expect(turn.answeredBy).toBe('rules');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects an empty question', async () => {
    const { source } = launch();
    await expect(source.ask!('   ')).rejects.toThrow();
  });
});

describe('DataSource.ask (synthetic source)', () => {
  it('answers over the in-memory seed', async () => {
    const source: DataSource = createSyntheticDataSource({ now: () => NOW });
    const turn = await source.ask!(QUESTION);
    expect(turn.answeredBy).toBe('rules');
    expect(turn.text).toMatch(/\$/);
  });
});
