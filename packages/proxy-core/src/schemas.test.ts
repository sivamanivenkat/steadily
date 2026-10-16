import { describe, expect, it } from 'vitest';
import { PROXY_LIMITS, proxyRequestSchema } from './schemas.ts';
import { askBody, categorizeBody } from './test-helpers.ts';

const valid = (value: unknown) => proxyRequestSchema.safeParse(value).success;

describe('request validation', () => {
  it('accepts a minimal categorize request', () => {
    expect(valid(categorizeBody())).toBe(true);
  });

  it('accepts custom category ids and negative (refund) amounts', () => {
    expect(valid(categorizeBody({ allowed: ['custom.kids_stuff'], amountMinor: -1299 }))).toBe(
      true,
    );
  });

  it('accepts an ask request with and without tool results', () => {
    expect(valid(askBody())).toBe(true);
    expect(
      valid(
        askBody({
          toolResults: [
            {
              id: 'toolu_01',
              name: 'category_total',
              input: { categoryId: 'food.coffee', period: 'this_month' },
              output: { totalMinor: 4210, count: 9 },
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['missing type', { merchant: 'X', amountMinor: 1, allowed: ['food.coffee'] }],
    ['unknown type', { type: 'chat', messages: [] }],
    ['raw passthrough', { type: 'messages', model: 'x', messages: [] }],
    ['not an object', 'categorize'],
    ['array', [categorizeBody()]],
    ['null', null],
  ])('rejects %s', (_name, body) => {
    expect(valid(body)).toBe(false);
  });

  describe('categorize', () => {
    it.each([
      ['empty merchant', { merchant: '   ' }],
      ['merchant over 200 chars', { merchant: 'A'.repeat(PROXY_LIMITS.merchantMaxChars + 1) }],
      ['fractional amount', { amountMinor: 4.75 }],
      ['huge amount', { amountMinor: 1e15 }],
      ['empty allowed', { allowed: [] }],
      ['unknown category id', { allowed: ['food.coffee', 'made.up'] }],
      ['duplicate ids', { allowed: ['food.coffee', 'food.coffee'] }],
    ])('rejects %s', (_name, overrides) => {
      expect(valid({ ...categorizeBody(), ...overrides })).toBe(false);
    });

    it('caps allowed ids at 40', () => {
      const ids = Array.from({ length: 41 }, (_, i) => `custom.c${i}`);
      expect(valid(categorizeBody({ allowed: ids.slice(0, 40) as never }))).toBe(true);
      expect(valid(categorizeBody({ allowed: ids as never }))).toBe(false);
    });

    it('rejects extra fields such as raw alert text or account data', () => {
      expect(valid({ ...categorizeBody(), alertText: 'synthetic' })).toBe(false);
      expect(valid({ ...categorizeBody(), accountLast4: '0000' })).toBe(false);
    });

    it('accepts a merchant of exactly 200 chars', () => {
      expect(valid(categorizeBody({ merchant: 'A'.repeat(200) }))).toBe(true);
    });
  });

  describe('ask', () => {
    it('rejects questions over 500 chars', () => {
      expect(valid(askBody({ question: 'q'.repeat(PROXY_LIMITS.questionMaxChars + 1) }))).toBe(
        false,
      );
      expect(valid(askBody({ question: 'q'.repeat(PROXY_LIMITS.questionMaxChars) }))).toBe(true);
    });

    it('rejects tool results over the 16 KB cap', () => {
      const output = { blob: 'x'.repeat(PROXY_LIMITS.toolResultsMaxBytes) };
      expect(
        valid(askBody({ toolResults: [{ id: 't1', name: 'category_total', input: {}, output }] })),
      ).toBe(false);
    });

    it('rejects tool results for tools that were not declared', () => {
      expect(
        valid(askBody({ toolResults: [{ id: 't1', name: 'list_raw', input: {}, output: 1 }] })),
      ).toBe(false);
    });

    it('rejects duplicate tool call ids and invalid ids', () => {
      const r = { id: 't1', name: 'category_total', input: {}, output: 1 };
      expect(valid(askBody({ toolResults: [r, r] }))).toBe(false);
      expect(valid(askBody({ toolResults: [{ ...r, id: 'bad id!' }] }))).toBe(false);
    });

    it('rejects too many tools, bad tool names and non-object input schemas', () => {
      const tool = askBody().tools[0]!;
      const many = Array.from({ length: PROXY_LIMITS.maxTools + 1 }, (_, i) => ({
        ...tool,
        name: `tool_${i}`,
      }));
      expect(valid(askBody({ tools: many }))).toBe(false);
      expect(valid(askBody({ tools: [{ ...tool, name: 'has space' }] }))).toBe(false);
      expect(valid(askBody({ tools: [{ ...tool, input_schema: { type: 'string' } }] }))).toBe(
        false,
      );
    });

    it('rejects tool definitions over the size cap', () => {
      const tool = askBody().tools[0]!;
      const big = Array.from({ length: PROXY_LIMITS.maxTools }, (_, i) => ({
        ...tool,
        name: `tool_${i}`,
        input_schema: { type: 'object', description: 'd'.repeat(1100) },
      }));
      expect(valid(askBody({ tools: big }))).toBe(false);
    });
  });
});
