import { describe, expect, it } from 'vitest';
import { EVENT_TYPES, parseNewEvent, parseStoredEvent } from './events';

const id = '0b0f3c3e-6f0a-4a4e-9a51-2f0f6c1d7b11';
const id2 = '5c8a3c1e-1d2b-4f6e-8a9b-0c1d2e3f4a5b';

describe('events', () => {
  it('parses a valid stored event', () => {
    const event = parseStoredEvent({
      id,
      type: 'transaction.categorized',
      at: '2026-10-15T08:12:00.000Z',
      causationId: id2,
      payload: {
        transactionId: id2,
        categoryId: 'food.coffee',
        confidence: 0.92,
        source: 'dictionary',
        needsReview: false,
      },
    });
    expect(event.type).toBe('transaction.categorized');
  });

  it('rejects unknown event types', () => {
    expect(() =>
      parseStoredEvent({
        id,
        type: 'nope',
        at: '2026-10-15T08:12:00.000Z',
        causationId: null,
        payload: {},
      }),
    ).toThrow();
  });

  it('rejects unknown category ids in payloads', () => {
    expect(() =>
      parseNewEvent({
        type: 'transaction.categorized',
        payload: {
          transactionId: id2,
          categoryId: 'food.unknown' as 'food.coffee',
          confidence: 0.5,
          source: 'classifier',
          needsReview: true,
        },
      }),
    ).toThrow();
  });

  it('does not allow raw text on capture events', () => {
    const parsed = parseNewEvent({
      type: 'transaction.captured',
      payload: {
        inboxId: id,
        source: 'android_notification',
        extracted: { amountMinor: 4520, currency: 'USD' },
        // @ts-expect-error raw text is not part of the contract
        rawText: 'Purchase alert: $45.20 at BLUE BOTTLE',
      },
    });
    expect(parsed.payload).not.toHaveProperty('rawText');
  });

  it('rejects fractional money', () => {
    expect(() =>
      parseNewEvent({
        type: 'subscription.detected',
        payload: {
          subscriptionId: id,
          merchantName: 'Netflix',
          cadence: 'monthly',
          amountMinor: 17.99,
          currency: 'USD',
        },
      }),
    ).toThrow();
  });

  it('accepts an optional positive threshold on notify requests', () => {
    const warning = {
      type: 'notify.request',
      payload: { kind: 'budget_warning', urgency: 'instant', budgetId: id, threshold: 100 },
    } as const;
    expect(parseNewEvent(warning).payload).toEqual(warning.payload);
    expect(() =>
      parseNewEvent({ ...warning, payload: { ...warning.payload, threshold: 0 } }),
    ).toThrow();
    expect(() =>
      parseNewEvent({
        type: 'notify.request',
        payload: { kind: 'weekly_checkin', urgency: 'instant' },
      }),
    ).not.toThrow();
  });

  it('exposes every event type', () => {
    expect(EVENT_TYPES).toContain('notify.request');
  });
});
