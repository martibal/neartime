'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createGoogleCoverageProvider, AGGREGATE_ENDPOINT } = require('./lib/googleCoverageProvider');
const { COMPLETE_TOP_K, DEGRADED, proveTopKByRating } = require('./lib/topKRatingPlanner');

function polygon() {
  return [
    [10.75, 59.91],
    [10.76, 59.91],
    [10.76, 59.92],
    [10.75, 59.92],
    [10.75, 59.91],
  ];
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test('Aggregate provider sends rating, price and operating-status filters server-side', async () => {
  const calls = [];
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ count: '7' });
    },
  });

  const result = await provider.aggregateSearch({
    polygon: polygon(),
    includedTypes: ['cafe'],
    includePlaceIds: false,
    ratingFilter: { minRating: 4.8, maxRating: 5 },
    priceLevels: ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE'],
    operatingStatus: ['OPERATING_STATUS_OPERATIONAL'],
  });

  assert.equal(result.count, 7);
  assert.equal(calls[0].url, AGGREGATE_ENDPOINT);
  assert.deepEqual(calls[0].body.filter.ratingFilter, { minRating: 4.8, maxRating: 5 });
  assert.deepEqual(calls[0].body.filter.priceLevels, ['PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE']);
  assert.deepEqual(calls[0].body.filter.operatingStatus, ['OPERATING_STATUS_OPERATIONAL']);
});

test('exact 5.0 top-k is complete without Place Details because all candidates tie on rating', async () => {
  const ids = Array.from({ length: 36 }, (_, index) => `p${String(index + 1).padStart(2, '0')}`);
  let detailCalls = 0;
  const result = await proveTopKByRating({
    polygon: polygon(),
    includedTypes: ['restaurant'],
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      assert.deepEqual(ratingFilter, { minRating: 5, maxRating: 5 });
      return includePlaceIds ? { count: 36, placeIds: ids } : { count: 36 };
    },
    placeDetails: async () => {
      detailCalls += 1;
      return { rating: 5, userRatingCount: 100 };
    },
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThreshold, 5);
  assert.equal(result.candidateCount, 36);
  assert.equal(result.topK.length, 20);
  assert.equal(result.aggregateCalls, 2);
  assert.equal(result.detailCalls, 0);
  assert.equal(detailCalls, 0);
  assert.equal(result.proof.tiePolicy, 'RATING_TIES_EQUIVALENT');
  assert.equal(result.proof.deterministicSelection, 'PLACE_ID_ASC');
});

test('rating proof stops when cumulative threshold contains enough candidates and returns verified top 20', async () => {
  const ids = Array.from({ length: 24 }, (_, index) => `p${index + 1}`);
  const counts = new Map([
    [5.0, 2],
    [4.9, 8],
    [4.8, 24],
  ]);
  const aggregateCalls = [];

  const result = await proveTopKByRating({
    polygon: polygon(),
    includedTypes: ['cafe'],
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      aggregateCalls.push({ includePlaceIds, minRating: ratingFilter.minRating });
      const count = counts.get(ratingFilter.minRating);
      assert.notEqual(count, undefined, `unexpected threshold ${ratingFilter.minRating}`);
      return includePlaceIds ? { count, placeIds: ids } : { count };
    },
    placeDetails: async ({ placeId }) => {
      const number = Number(placeId.replace('p', ''));
      return {
        id: placeId,
        rating: number <= 8 ? 4.9 : 4.8,
        userRatingCount: 1000 - number,
      };
    },
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThreshold, 4.8);
  assert.equal(result.candidateCount, 24);
  assert.equal(result.topK.length, 20);
  assert.equal(result.aggregateCalls, 4);
  assert.equal(result.detailCalls, 24);
  assert.deepEqual(aggregateCalls.map((entry) => entry.minRating), [5, 4.9, 4.8, 4.8]);
  assert.equal(result.topK[0].rating, 4.9);
  assert.equal(result.proof.complete, true);
});

test('fewer than 20 rated matches is still complete when threshold 1.0 proves the full rated universe', async () => {
  const thresholds = [5, 4, 3, 2, 1];
  const result = await proveTopKByRating({
    polygon: polygon(),
    includedTypes: ['book_store'],
    ratingThresholds: thresholds,
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      const count = ratingFilter.minRating === 1 ? 7 : Math.max(0, 5 - ratingFilter.minRating);
      return includePlaceIds
        ? { count: 7, placeIds: Array.from({ length: 7 }, (_, index) => `p${index + 1}`) }
        : { count };
    },
    placeDetails: async ({ placeId }) => ({ id: placeId, rating: 4.2, userRatingCount: 10 }),
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.topK.length, 7);
  assert.equal(result.proof.fewerThanKAvailable, true);
});

test('planner fails closed before expensive Details fanout when the proven candidate set exceeds its hard cap', async () => {
  let detailCalls = 0;
  const result = await proveTopKByRating({
    polygon: polygon(),
    includedTypes: ['restaurant'],
    aggregateSearch: async ({ ratingFilter }) => ({ count: ratingFilter.minRating === 5 ? 120 : 0 }),
    placeDetails: async () => {
      detailCalls += 1;
      return { rating: 5, userRatingCount: 1 };
    },
  });

  assert.equal(result.status, DEGRADED);
  assert.equal(result.reason, 'top_k_candidate_cap_exceeded');
  assert.equal(result.candidateCount, 120);
  assert.equal(detailCalls, 0);
});

test('planner fails closed if Aggregate says a rating-filtered candidate has no qualifying rating', async () => {
  const result = await proveTopKByRating({
    polygon: polygon(),
    includedTypes: ['cafe'],
    k: 1,
    ratingThresholds: [4.8, 1],
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      if (ratingFilter.minRating === 4.8) return includePlaceIds ? { count: 1, placeIds: ['p1'] } : { count: 1 };
      return { count: 1 };
    },
    placeDetails: async () => ({ id: 'p1' }),
  });

  assert.equal(result.status, DEGRADED);
  assert.equal(result.reason, 'top_k_rating_filter_contract_mismatch');
});
