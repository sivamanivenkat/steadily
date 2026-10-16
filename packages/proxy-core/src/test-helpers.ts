import type { AskRequest, CategorizeRequest } from './schemas.ts';

// Synthetic fixtures only (D-011): no real merchants, accounts or people.

export function categorizeBody(overrides: Partial<CategorizeRequest> = {}): CategorizeRequest {
  return {
    type: 'categorize',
    merchant: 'SYNTH COFFEE CO 0001',
    amountMinor: 475,
    allowed: ['food.coffee', 'food.dining', 'other.general'],
    ...overrides,
  };
}

export function askBody(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    type: 'ask',
    question: 'How much did I spend on coffee this month?',
    tools: [
      {
        name: 'category_total',
        description: 'Total spending for a category over a period, in cents.',
        input_schema: {
          type: 'object',
          properties: { categoryId: { type: 'string' }, period: { type: 'string' } },
          required: ['categoryId', 'period'],
        },
      },
    ],
    toolResults: [],
    ...overrides,
  };
}

export function anthropicResponse(
  content: unknown[],
  usage = { input_tokens: 120, output_tokens: 30 },
  stopReason = 'end_turn',
): Response {
  return new Response(JSON.stringify({ content, stop_reason: stopReason, usage }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

export function toolUse(input: Record<string, unknown>, name = 'choose_category', id = 'toolu_1') {
  return { type: 'tool_use', id, name, input };
}
