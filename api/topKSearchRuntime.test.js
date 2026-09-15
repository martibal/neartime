'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  budgetQuantities,
  mergeRatingFilter,
  normalizeRankingMode,
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

test('minimum-reviews proof reserves a bounded 100 details and 100 routes for every ranking mode', () => {
  for (const rankingMode of ['RATING', 'PRICE', 'TRAVEL_TIME']) {
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
