import { describe, expect, it } from 'vitest';
import { answerWithRules, formatMoney, HELP_TEXT } from './rules';
import { budget, context, seedRepos, subscription } from './fixtures';

const repos = seedRepos();
const ctx = context(repos);

const CASES: [string, string][] = [
  ['How much did I spend this month?', "So far this month you've spent $295.99."],
  ['how much have I spent', "So far this month you've spent $295.99."],
  ["What's my total spending?", "So far this month you've spent $295.99."],
  ['How much did I spend last month?', 'You spent $250.00 last month.'],
  ['How much did I spend in September?', 'You spent $250.00 last month.'],
  ['how much did i spend in august', "You haven't spent anything in August 2026."],
  ['How much did I spend in October 2025?', "You haven't spent anything in October 2025."],
  ['How much did I spend in the last 7 days?', 'You spent $50.99 in the last 7 days.'],
  ['how much did i spend this week', 'You spent $50.99 in the last 7 days.'],
  ['how much did i spend today', "You haven't spent anything today."],
  [
    'How much did I spend on groceries this month?',
    "So far this month you've spent $200.00 on Groceries.",
  ],
  ['how much did i spend on eating out last month', 'You spent $50.00 on Dining Out last month.'],
  [
    'How much did I spend on coffee in the last 30 days?',
    'You spent $30.00 on Coffee in the last 30 days.',
  ],
  [
    'How much did I spend on subscriptions?',
    "So far this month you've spent $10.99 on Subscriptions.",
  ],
  [
    'how much did i spend on gas this month',
    "You haven't spent anything on Gas so far this month.",
  ],
  [
    'How much did I spend at Starbucks this month',
    "So far this month you've spent $30.00 at Starbucks.",
  ],
  [
    "How much did I spend at trader joe's last month?",
    "You spent $200.00 at Trader Joe's last month.",
  ],
  [
    'how much did i spend on quantum llamas',
    `I couldn't match "quantum llamas" to a category or a merchant. Try a category like groceries or dining, or a merchant you've paid.`,
  ],
  [
    'What are my top merchants?',
    "Your top merchants this month:\n1. Trader Joe's: $120.00\n2. Whole Foods Market: $80.00\n3. Starbucks: $30.00\n4. Taqueria Sol: $30.00\n5. Jane Quill: $25.00",
  ],
  [
    'Where did my money go last month?',
    "Your top merchants last month:\n1. Trader Joe's: $200.00\n2. Taqueria Sol: $50.00",
  ],
  [
    'show me my top 2 merchants this month',
    "Your top merchants this month:\n1. Trader Joe's: $120.00\n2. Whole Foods Market: $80.00",
  ],
  [
    'Compare this month to last month',
    'You spent $295.99 this month versus $250.00 last month: $45.99 more (18.4% higher).\nBiggest change: Coffee, $30.00 more.',
  ],
  [
    'how does spending compare to last month',
    'You spent $295.99 this month versus $250.00 last month: $45.99 more (18.4% higher).\nBiggest change: Coffee, $30.00 more.',
  ],
  [
    'compare September vs October',
    'You spent $250.00 last month versus $295.99 this month: $45.99 less (15.5% lower).\nBiggest change: Coffee, $30.00 less.',
  ],
  [
    'What subscriptions are coming up?',
    "I don't see any subscription charges coming up in the next 30 days.",
  ],
  ['hello there', HELP_TEXT],
  ['', HELP_TEXT],
];

describe('rules-based answerer', () => {
  for (const [question, expected] of CASES) {
    it(`answers: ${question || '(empty)'}`, async () => {
      expect(await answerWithRules(question, ctx)).toBe(expected);
    });
  }

  it('answers budget questions', async () => {
    const r = seedRepos();
    expect(await answerWithRules('Am I on budget?', context(r))).toBe(
      "You haven't set any budgets yet. Add one in Budgets and I can tell you how you're pacing.",
    );
    for (const b of [
      budget({ categoryId: null, amountMinor: 100000 }),
      budget({ categoryId: 'food.groceries', amountMinor: 30000 }),
    ]) {
      r.budgets.rows.set(b.id, b);
    }
    expect(await answerWithRules('Am I on budget?', context(r))).toBe(
      "You're a little ahead of pace on 1 of 2 budgets this month.\n- Overall: $295.99 of $1,000.00 (30%), on track\n- Groceries: $200.00 of $300.00 (67%), a little ahead of pace",
    );
    const extra = budget({ categoryId: 'food.coffee', amountMinor: 2500 });
    r.budgets.rows.set(extra.id, extra);
    expect(await answerWithRules('how are my budgets doing', context(r))).toContain(
      "You're over budget on 1 of 3 budgets this month.",
    );
  });

  it('answers subscription questions', async () => {
    const r = seedRepos();
    const s = subscription();
    r.subscriptions.rows.set(s.id, s);
    expect(await answerWithRules('what subscriptions are coming up', context(r))).toBe(
      'Coming up in the next 30 days:\n- Netflix: $15.49 on Oct 20 (monthly)\nTotal: $15.49',
    );
    expect(await answerWithRules('any upcoming bills?', context(r))).toContain('Netflix');
  });

  it('formats money', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
    expect(formatMoney(-250)).toBe('-$2.50');
    expect(formatMoney(1000, 'EUR')).toBe('EUR 10.00');
  });

  it('never uses the cloud privacy view for its own (local) answers', async () => {
    const text = await answerWithRules('top merchants', context(seedRepos(), { privacy: 'cloud' }));
    expect(text).toContain('Jane Quill');
  });
});
