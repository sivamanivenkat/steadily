import { createTestDb } from '@steadily/db/node';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { DataSource } from '@/data';
import { createRepoDataSource } from '@/data/repoDataSource';
import { createAppLogger, createAppRuntime } from '@/data/runtime';
import type { AskTurn } from '@/data/types';
import { makeSource, FIXED_NOW, renderWithData } from '@/testing/render';

import { ASK_SUGGESTIONS, AskScreen } from '../AskScreen';

const newId = () => globalThis.crypto.randomUUID();

function turn(question: string, text: string, answeredBy: AskTurn['answeredBy']): AskTurn {
  return { id: newId(), question, text, answeredBy, at: FIXED_NOW.toISOString() };
}

/** A synthetic source whose `ask` is replaced by `ask`. */
function withAsk(ask: DataSource['ask']): DataSource {
  const source = makeSource();
  if (ask) source.ask = ask;
  else delete source.ask;
  return source;
}

async function type(text: string) {
  await fireEvent.changeText(screen.getByLabelText('Your question'), text);
}

describe('AskScreen', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers an end-to-end question from a real in-memory database', async () => {
    const { db } = createTestDb();
    const app = createAppRuntime(db, {
      newId,
      clock: () => FIXED_NOW,
      log: createAppLogger(false),
    });
    const source = createRepoDataSource({ db, ...app, newId, now: () => FIXED_NOW });
    await source.captureAlerts([
      {
        text: 'You made a $5 transaction with SQ *BLUE BOTTLE COFFEE on your card ending in 1234',
        source: 'android_notification',
        androidPackage: 'com.chase.sig.android',
        occurredAt: new Date(2026, 9, 12, 12).toISOString(),
      },
    ]);
    await renderWithData(<AskScreen />, source);

    await type('How much did I spend this month?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText(/\$5\.00/)).toBeOnTheScreen();
    expect(screen.getByText('On-device')).toBeOnTheScreen();
    expect(screen.queryByText('Answered with cloud AI')).toBeNull();
  });

  it('shows the empty state with starter chips that send the question', async () => {
    const ask = jest.fn(async (q: string) => turn(q, 'Answer one', 'rules'));
    await renderWithData(<AskScreen />, withAsk(ask));

    expect(screen.getByText('Ask about your money')).toBeOnTheScreen();
    expect(screen.getByText(/answered on this phone/)).toBeOnTheScreen();
    for (const suggestion of ASK_SUGGESTIONS) {
      expect(screen.getByRole('button', { name: suggestion })).toBeOnTheScreen();
    }

    await fireEvent.press(screen.getByRole('button', { name: 'Am I on budget?' }));
    expect(ask).toHaveBeenCalledWith('Am I on budget?');
    expect(await screen.findByText('Answer one')).toBeOnTheScreen();
    // The conversation replaces the empty state.
    expect(screen.queryByText('Ask about your money')).toBeNull();
  });

  it.each([
    ['rules', true],
    ['on_device_llm', true],
    ['cloud_llm', false],
  ] as const)('labels %s answers correctly', async (answeredBy, onDevice) => {
    await renderWithData(
      <AskScreen />,
      withAsk(async (q) => turn(q, 'Some answer', answeredBy)),
    );
    await type('hello');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Some answer');

    if (onDevice) {
      expect(screen.getByText('On-device')).toBeOnTheScreen();
      expect(screen.queryByText('Answered with cloud AI')).toBeNull();
    } else {
      expect(screen.getByText('Answered with cloud AI')).toBeOnTheScreen();
      expect(screen.queryByText('On-device')).toBeNull();
    }
  });

  it('shows a loading state while the answer is pending', async () => {
    let finish: (t: AskTurn) => void = () => {};
    const ask = jest.fn(
      (q: string) =>
        new Promise<AskTurn>((resolve) => {
          finish = () => resolve(turn(q, 'Done now', 'rules'));
        }),
    );
    await renderWithData(<AskScreen />, withAsk(ask));
    await type('Slow one');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByLabelText('Working on your answer')).toBeOnTheScreen();
    // One question at a time.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    finish(turn('', '', 'rules'));
    expect(await screen.findByText('Done now')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Working on your answer')).toBeNull();
  });

  it('shows an error and retries the same question', async () => {
    const ask = jest
      .fn<Promise<AskTurn>, [string]>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementation(async (q) => turn(q, 'Second try worked', 'rules'));
    await renderWithData(<AskScreen />, withAsk(ask));
    await type('Top merchants last month');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('That did not work')).toBeOnTheScreen();
    expect(screen.getByText('Top merchants last month')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Second try worked')).toBeOnTheScreen();
    expect(screen.queryByText('That did not work')).toBeNull();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenLastCalledWith('Top merchants last month');
  });

  it('clears the conversation', async () => {
    await renderWithData(
      <AskScreen />,
      withAsk(async (q) => turn(q, 'An answer', 'rules')),
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    await type('Question one');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('An answer');

    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('An answer')).toBeNull();
    expect(screen.getByText('Ask about your money')).toBeOnTheScreen();
  });

  it('announces answers and voices amounts as currency', async () => {
    await renderWithData(
      <AskScreen />,
      withAsk(async (q) => turn(q, 'You spent $45.20 so far.', 'rules')),
    );
    await type('How much?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('You spent $45.20 so far.');

    expect(screen.getByLabelText('You spent 45 dollars and 20 cents so far.')).toBeOnTheScreen();
    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'You spent 45 dollars and 20 cents so far.',
      ),
    );
  });

  it('degrades gracefully when the data source cannot ask', async () => {
    await renderWithData(<AskScreen />, withAsk(undefined));

    expect(screen.getByText('Asking is not available in this build yet.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: ASK_SUGGESTIONS[0]! })).toBeNull();
    expect(screen.getByLabelText('Your question').props.editable).toBe(false);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('ignores empty input', async () => {
    const ask = jest.fn(async (q: string) => turn(q, 'x', 'rules'));
    await renderWithData(<AskScreen />, withAsk(ask));
    await type('   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(ask).not.toHaveBeenCalled();
  });
});
