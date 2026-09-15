'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertProviderSearchCeiling,
  budgetQuantities,
  mergeRatingFilter,
  normalizeRankingMode,
  providerCostSpecs,
  unsupportedHardFilterReason,
} = require('./lib/topKSearchRuntime');

test('normalizes supported ranking modes', () => {
  assert.equal(normalizeRankingMode('rating'), 'RATING');
  assert.equal(normalizeRankingMode('PRICE'), 'PRICE');
  assert.equal(normalizeRankingMode('travel_time'), 'TRAVEL_TIME');
  assert.throws(() => normalizeRankingMode('distance'), /invalid_ranking_mode/);
});

test('hard rating floor is merged conservatively', () => {
  assert.deepEqual(
    mergeRatingFilter({ minRating: 4.5, maxRating: 5 }, { minRating: 4.8, maxRating: 5 }),
    { minRating: 4.8, maxRating: 5 },
  );
  assert.deepEqual(
    mergeRatingFilter(null, { minRating: 4.2, maxRating: 5 }),
    { minRating: 4.2, maxRating: 5 },
  );
});

test('minimum reviews is supported while opening-hours filters still fail before provider work', () => {
  assert.equal(unsupportedHardFilterReason({ minimumReviews: 100 }), null);
  assert.equal(unsupportedHardFilterReason({ openNow: true }), 'top_k_open_now_proof_not_ready');
  assert.equal(unsupportedHardFilterReason({ openForMinutes: 60 }), 'top_k_open_for_minutes_proof_not_ready');
  assert.equal(unsupportedHardFilterReason({ minimumReviews: 0, openNow: false, openForMinutes: 0 }), null);
});

test('worst-case budget includes proof and finalist enrichment before admission', () => {
  const rating = budgetQuantities({ rankingMode: 'RATING', travelMode: 'Walk', maxMinutes: 10 });
  assert.equal(rating.aggregate, 18);
  assert.equal(rating.details, 100);
  assert.equal(rating.route, 100);
  assert.equal(rating.routeSkuId, '9392-1087-2045');

  const price = budgetQuantities({ rankingMode: 'PRICE', travelMode: 'Walk', maxMinutes: 10 });
  assert.equal(price.aggregate, 10);
  assert.equal(price.details, 20);
  assert.equal(price.route, 500);

  const travel = budgetQuantities({ rankingMode: 'TRAVEL_TIME', travelMode: 'Drive', maxMinutes: 10 });
  assert.equal(travel.aggregate, 8);
  assert.equal(travel.details, 20);
  assert.equal(travel.route, 120);
  assert.equal(travel.routeSkuId, '2E25-887A-DAD4');
});

test('minimum-reviews proof reserves bounded details/routes and expanded rating aggregate proof', () => {
  const rating = budgetQuantities({
    rankingMode: 'RATING', travelMode: 'Walk', maxMinutes: 10, minimumReviews: 100,
  });
  assert.equal(rating.aggregate, 36);
  assert.equal(rating.details, 100);
  assert.equal(rating.route, 100);

  for (const rankingMode of ['PRICE', 'TRAVEL_TIME']) {
    const budget = budgetQuantities({
      rankingMode,
      travelMode: 'Walk',
      maxMinutes: 10,
      minimumReviews: 100,
    });
    assert.equal(budget.details, 100);
    assert.equal(budget.route, 100);
  }
});

test('provider cost plan is derived from the exact worst-case quantities', () => {
  const quantities = {
    aggregate: 8,
    details: 20,
    route: 120,
    routeSkuId: '2E25-887A-DAD4',
  };
  assert.deepEqual(providerCostSpecs(quantities), [
    { name: 'aggregate', skuId: '546C-66B2-E5A6', quantity: 8 },
    { name: 'details', skuId: '2D9A-3DE0-3766', quantity: 20 },
    { name: 'route', skuId: '2E25-887A-DAD4', quantity: 120 },
  ]);
});

test('NOK 9.99 equivalent passes the pre-reservation ceiling gate', async () => {
  const calls = [];
  const supabaseRpc = async (name, body) => {
    calls.push({ name, body });
    return [{
      allowed: true,
      reason: 'within_per_search_cost_ceiling',
      worst_case_micro_usd: 900000,
      worst_case_micro_nok: 9990000,
      max_search_micro_nok: 10000000,
      conservative_nok_per_usd_micro: 11100000,
    }];
  };

  const decision = await assertProviderSearchCeiling({
    quantities: { aggregate: 1, details: 1, route: 1, routeSkuId: '2E25-887A-DAD4' },
    supabaseRpc,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.worst_case_micro_nok, 9990000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'check_provider_cogs_search_ceiling');
});

test('NOK 10.01 equivalent fails closed before any provider reservation', async () => {
  let reservationCalls = 0;
  const supabaseRpc = async (name) => {
    if (name === 'reserve_provider_cogs') reservationCalls += 1;
    if (name === 'check_provider_cogs_search_ceiling') {
      return [{
        allowed: false,
        reason: 'per_search_cost_ceiling_exceeded',
        worst_case_micro_usd: 910000,
        worst_case_micro_nok: 10010000,
        max_search_micro_nok: 10000000,
        conservative_nok_per_usd_micro: 11000000,
      }];
    }
    throw new Error(`unexpected_rpc:${name}`);
  };

  await assert.rejects(
    () => assertProviderSearchCeiling({
      quantities: { aggregate: 1, details: 1, route: 1, routeSkuId: '2E25-887A-DAD4' },
      supabaseRpc,
    }),
    (error) => error.code === 'per_search_cost_ceiling_exceeded',
  );
  assert.equal(reservationCalls, 0);
});
