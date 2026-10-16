import { describe, expect, it } from 'vitest';
import {
  buildAskRequest,
  buildCategorizeRequest,
  CATEGORIZE_TOOL_NAME,
  DEFAULT_MODELS,
  formatAmount,
  mapAskResponse,
  mapCategorizeResponse,
  type MessagesResponse,
} from './anthropic.ts';
import { askBody, categorizeBody, toolUse } from './test-helpers.ts';

const res = (content: MessagesResponse['content']): MessagesResponse => ({ content });

describe('buildCategorizeRequest', () => {
  it('forces the choose_category tool with an enum of exactly the allowed ids', () => {
    const body = categorizeBody();
    const req = buildCategorizeRequest(body, DEFAULT_MODELS.categorize);
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.tool_choice).toEqual({ type: 'tool', name: CATEGORIZE_TOOL_NAME });
    const schema = req.tools?.[0]?.['input_schema'] as {
      properties: { categoryId: { enum: string[] } };
    };
    expect(schema.properties.categoryId.enum).toEqual(body.allowed);
  });

  it('sends only merchant and amount in the prompt', () => {
    const req = buildCategorizeRequest(categorizeBody(), 'm');
    expect(req.messages).toEqual([
      { role: 'user', content: 'Merchant: SYNTH COFFEE CO 0001\nAmount: $4.75' },
    ]);
  });

  it('formats amounts', () => {
    expect(formatAmount(0)).toBe('$0.00');
    expect(formatAmount(-1205)).toBe('-$12.05');
    expect(formatAmount(100000)).toBe('$1000.00');
  });
});

describe('mapCategorizeResponse', () => {
  const allowed = categorizeBody().allowed;

  it('returns the chosen allowed id and confidence', () => {
    expect(
      mapCategorizeResponse(
        res([toolUse({ categoryId: 'food.coffee', confidence: 0.9 })]),
        allowed,
      ),
    ).toEqual({ type: 'categorize', result: { categoryId: 'food.coffee', confidence: 0.9 } });
  });

  it.each([
    ['id outside the allowed list', { categoryId: 'shopping.general', confidence: 0.9 }],
    ['invented id', { categoryId: 'coffee', confidence: 0.9 }],
    ['missing confidence', { categoryId: 'food.coffee' }],
    ['confidence above 1', { categoryId: 'food.coffee', confidence: 1.5 }],
    ['negative confidence', { categoryId: 'food.coffee', confidence: -0.1 }],
    ['string confidence', { categoryId: 'food.coffee', confidence: '0.9' }],
    ['non-string id', { categoryId: 7, confidence: 0.5 }],
  ])('returns null for %s', (_name, input) => {
    expect(mapCategorizeResponse(res([toolUse(input)]), allowed).result).toBeNull();
  });

  it('returns null when the model answered with text or another tool', () => {
    expect(
      mapCategorizeResponse(res([{ type: 'text', text: 'food.coffee' }]), allowed).result,
    ).toBe(null);
    expect(
      mapCategorizeResponse(
        res([toolUse({ categoryId: 'food.coffee', confidence: 1 }, 'other_tool')]),
        allowed,
      ).result,
    ).toBeNull();
  });

  it('never returns an id outside allowed, for any model output', () => {
    const candidates = ['food.coffee', 'food.dining', 'other.general', 'travel.general', '', 'x'];
    for (const categoryId of candidates) {
      for (const confidence of [0, 0.5, 1, 2, Number.NaN]) {
        const out = mapCategorizeResponse(res([toolUse({ categoryId, confidence })]), allowed);
        if (out.result) expect(allowed).toContain(out.result.categoryId);
      }
    }
  });
});

describe('ask', () => {
  it('builds a Sonnet request with the device tools and no tool turns on the first step', () => {
    const req = buildAskRequest(askBody(), DEFAULT_MODELS.ask);
    expect(req.model).toBe('claude-sonnet-5-5');
    expect(req.messages).toHaveLength(1);
    expect(req.tools?.map((t) => t['name'])).toEqual(['category_total']);
  });

  it('replays earlier tool calls and their results', () => {
    const req = buildAskRequest(
      askBody({
        toolResults: [
          {
            id: 'toolu_1',
            name: 'category_total',
            input: { categoryId: 'food.coffee', period: 'this_month' },
            output: { totalMinor: 4210 },
          },
        ],
      }),
      'm',
    );
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(req.messages[2]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"totalMinor":4210}' },
    ]);
  });

  it('maps tool_use to tool calls and text to an answer', () => {
    const body = askBody();
    expect(
      mapAskResponse(
        res([toolUse({ categoryId: 'food.coffee' }, 'category_total', 'toolu_9')]),
        body,
      ),
    ).toEqual({
      type: 'ask',
      kind: 'tool_calls',
      calls: [{ id: 'toolu_9', name: 'category_total', input: { categoryId: 'food.coffee' } }],
    });
    expect(mapAskResponse(res([{ type: 'text', text: ' About $42. ' }]), body)).toEqual({
      type: 'ask',
      kind: 'answer',
      text: 'About $42.',
    });
  });

  it('rejects calls to undeclared tools and empty answers', () => {
    const body = askBody();
    expect(mapAskResponse(res([toolUse({}, 'delete_everything')]), body)).toBeNull();
    expect(mapAskResponse(res([]), body)).toBeNull();
  });
});
