import { describe, expect, it } from 'vitest';
import { isCategoryId } from '@steadily/taxonomy';
import { DICTIONARY, lookupMerchant, normalizeMerchant, toMerchantKey } from './index';

describe('normalizeMerchant', () => {
  it.each([
    // processor prefixes
    ['SQ *BLUE BOTTLE COFFEE', 'Blue Bottle Coffee', 'blue_bottle_coffee'],
    ['SQ*JOES COFFEE', 'Joes Coffee', 'joes_coffee'],
    ['  sq *  sunrise   cafe ', 'Sunrise Cafe', 'sunrise_cafe'],
    ['TST* JOES DINER', 'Joes Diner', 'joes_diner'],
    ['TST*THE LOCAL TAVERN', 'The Local Tavern', 'the_local_tavern'],
    ['PAYPAL *EXAMPLESHOP', 'Exampleshop', 'exampleshop'],
    ['PP*GREENLEAF GOODS', 'Greenleaf Goods', 'greenleaf_goods'],
    ['SP * EXAMPLE GOODS', 'Example Goods', 'example_goods'],
    ['DD *CHIPOTLE 1234', 'Chipotle', 'chipotle'],
    ['DOORDASH*SHAKE SHACK', 'Shake Shack', 'shake_shack'],
    ['GOOGLE *YOUTUBEPREMIUM', 'YouTube', 'youtube'],
    // aggregators
    ['UBER *TRIP', 'Uber', 'uber'],
    ['UBER* TRIP HELP.UBER.COM', 'Uber', 'uber'],
    ['UBER *EATS', 'Uber Eats', 'uber_eats'],
    ['AMZN Mktp US*2K4AB1C23', 'Amazon', 'amazon'],
    ['Amazon.com*AB12CD34', 'Amazon', 'amazon'],
    ['AMAZON PRIME*1A2B3C', 'Amazon Prime', 'amazon_prime'],
    ['APPLE.COM/BILL', 'Apple', 'apple'],
    // store numbers, codes, phone numbers, domains
    ['STARBUCKS STORE 12345 SEATTLE WA', 'Starbucks', 'starbucks'],
    ['WALGREENS #1234', 'Walgreens', 'walgreens'],
    ['BP#1234567', 'BP', 'bp'],
    ['CVS/PHARMACY #01234', 'CVS', 'cvs'],
    ['TARGET T-1234', 'Target', 'target'],
    ['TARGET 00012345', 'Target', 'target'],
    ['COSTCO WHSE #0123', 'Costco', 'costco'],
    ['WAL-MART #1234', 'Walmart', 'walmart'],
    ['NETFLIX.COM', 'Netflix', 'netflix'],
    ['SPOTIFY*P1234ABCD', 'Spotify', 'spotify'],
    ['HULU 800-555-0100', 'Hulu', 'hulu'],
    ['BESTBUY.COM 00012345', 'Best Buy', 'best_buy'],
    ['DELTA AIR LINES 0062345', 'Delta Air Lines', 'delta_air_lines'],
    ["MCDONALD'S F12345", "McDonald's", 'mcdonalds'],
    ['Chick-fil-A #01234', 'Chick-fil-A', 'chick_fil_a'],
    ['DUNKIN #345678', "Dunkin'", 'dunkin'],
    ['KFC 123', 'KFC', 'kfc'],
    ['AT&T*BILL PAYMENT', 'AT&T', 'att'],
    // dictionary aliases and dropped apostrophes
    ['TRADER JOE S #552', "Trader Joe's", 'trader_joes'],
    ['WHOLEFDS MKT 10234', 'Whole Foods Market', 'whole_foods_market'],
    ['SHELL OIL 57444 HOUSTON TX', 'Shell', 'shell'],
    ['CHIPOTLE AUSTIN TX', 'Chipotle', 'chipotle'],
    // unknown merchants: city/state, suffixes, title case
    ['JOES PIZZA AUSTIN TX', 'Joes Pizza', 'joes_pizza'],
    ['GREEN LEAF CAFE SAN FRANCISCO CA', 'Green Leaf Cafe', 'green_leaf_cafe'],
    ['ACME PIZZA CO', 'Acme Pizza Co', 'acme_pizza_co'],
    ['CORNER BAKERY LLC', 'Corner Bakery', 'corner_bakery'],
    ['LOCAL BAR AND GRILL', 'Local Bar and Grill', 'local_bar_and_grill'],
    ['MARIA S TACOS', "Maria's Tacos", 'marias_tacos'],
    ['7-ELEVEN 12345', '7-Eleven', '7_eleven'],
  ])('%j -> %s', (raw, name, key) => {
    expect(normalizeMerchant(raw)).toEqual({ name, key });
  });

  it('returns empty name and key for blank input', () => {
    expect(normalizeMerchant('   ')).toEqual({ name: '', key: '' });
  });

  it('gives the same key for different descriptors of one store', () => {
    expect(normalizeMerchant('SQ *JOES COFFEE').key).toBe(normalizeMerchant('JOES COFFEE #2').key);
    expect(normalizeMerchant('STARBUCKS 01234').key).toBe(normalizeMerchant('Starbucks').key);
  });

  it('is idempotent on its own output', () => {
    for (const raw of ['SQ *BLUE BOTTLE COFFEE', 'TST* JOES DINER', 'AMZN Mktp US*2K4AB1C23']) {
      const once = normalizeMerchant(raw);
      expect(normalizeMerchant(once.name)).toEqual(once);
    }
  });
});

describe('toMerchantKey', () => {
  it('is lowercase, underscore-separated and drops apostrophes and ampersands', () => {
    expect(toMerchantKey("Trader Joe's")).toBe('trader_joes');
    expect(toMerchantKey('AT&T')).toBe('att');
    expect(toMerchantKey('  Café  Rio ')).toBe('cafe_rio');
  });
});

describe('merchant dictionary', () => {
  const merchants = DICTIONARY.merchants;

  it('has around 150+ merchants', () => {
    expect(merchants.length).toBeGreaterThanOrEqual(150);
  });

  it('uses only taxonomy category ids', () => {
    for (const m of merchants) expect(isCategoryId(m.categoryId), m.key).toBe(true);
  });

  it('derives every key from its name', () => {
    for (const m of merchants) expect(m.key).toBe(toMerchantKey(m.name));
  });

  it('has unique keys and aliases', () => {
    const all = merchants.flatMap((m) => [m.key, ...(m.aliases ?? [])]);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every merchant normalizes to itself', () => {
    for (const m of merchants) expect(normalizeMerchant(m.name).key, m.name).toBe(m.key);
  });

  it('flags big-box merchants as multi-category', () => {
    for (const key of ['amazon', 'target', 'walmart', 'costco', 'sams_club', 'cvs', 'walgreens']) {
      expect(lookupMerchant(key)?.multiCategory, key).toBe(true);
    }
    expect(lookupMerchant('starbucks')?.multiCategory).toBeUndefined();
  });

  it('looks up by key and alias', () => {
    expect(lookupMerchant('starbucks')?.categoryId).toBe('food.coffee');
    expect(lookupMerchant('amzn_mktp_us')?.key).toBe('amazon');
    expect(lookupMerchant('wholefds_mkt')?.categoryId).toBe('food.groceries');
    expect(lookupMerchant('netflix')?.categoryId).toBe('subscriptions.general');
    expect(lookupMerchant('shell')?.categoryId).toBe('transport.gas');
    expect(lookupMerchant('not_a_real_merchant')).toBeUndefined();
  });
});
