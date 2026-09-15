'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPLETE_TOP_K } = require('./lib/topKProofPlanner');
const {
  provePriceTopKWithHardTravel,
  proveRatingTopKWithHardTravel,
} = require('./lib/topKHardTravelProof');

const POLYGON = [[10.75, 59.91], [10.76, 59.91], [10.76, 59.92], [10.75, 59.92], [10.75, 59.91]];

test('rating proof lowers threshold when polygon candidates fail exact max travel time', async () => {
  const high = Array.from({ length: 20 }, (_, i) => `h${i + 1}`);
  const lower = Array.from({ length: 10 }, (_, i) => `l${i + 1}`);
  const all = [...high, ...lower];
  const routed = [];
  const result = await proveRatingTopKWithHardTravel({
    polygon: POLYGON,
    includedTypes: ['cafe'],
    maxMinutes: 10,
    k: 20,
    ratingThresholds: [5, 4.9, 1],
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      const ids = ratingFilter.minRating === 5 ? high : all;
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
    routeMatrixCompute: async ({ placeId }) => {
      routed.push(placeId);
      const outside = placeId.startsWith('h') && Number(placeId.slice(1)) > 10;
      return { routingSummary: { legs: [{ duration: outside ? '700s' : '300s' }] } };
    },
    placeDetails: async ({ placeId }) => ({
      rating: placeId.startsWith('h') ? 5 : 4.9,
      userRatingCount: 100,
    }),
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThreshold, 4.9);
  assert.equal(result.topK.length, 20);
  assert.equal(result.exactQualifiedCount, 20);
  assert.equal(result.proof.hardTravelConstraint, true);
  assert.equal(new Set(routed).size, 30);
  assert.equal(routed.length, 30, 'route cache must avoid rerouting high-threshold candidates');
  assert.ok(result.topK.every((candidate) => candidate.travelTimeSeconds <= 600));
});

test('exact five-star ties are selected only from exact in-time candidates', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
  let details = 0;
  const result = await proveRatingTopKWithHardTravel({
    polygon: POLYGON,
    includedTypes: ['restaurant'],
    maxMinutes: 10,
    k: 20,
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      assert.equal(ratingFilter.minRating, 5);
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
    routeMatrixCompute: async ({ placeId }) => ({
      routingSummary: { legs: [{ duration: Number(placeId.slice(1)) <= 25 ? '500s' : '800s' }] },
    }),
    placeDetails: async () => { details += 1; return { rating: 5 }; },
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.topK.length, 20);
  assert.equal(result.exactQualifiedCount, 25);
  assert.equal(details, 0);
  assert.ok(result.topK.every((candidate) => candidate.travelTimeSeconds <= 600));
});

test('price proof skips out-of-time places and continues into later price buckets', async () => {
  const free = Array.from({ length: 15 }, (_, i) => `f${i + 1}`);
  const cheap = Array.from({ length: 20 }, (_, i) => `c${i + 1}`);
  const buckets = {
    PRICE_LEVEL_FREE: free,
    PRICE_LEVEL_INEXPENSIVE: cheap,
  };
  const result = await provePriceTopKWithHardTravel({
    polygon: POLYGON,
    includedTypes: ['cafe'],
    maxMinutes: 10,
    k: 20,
    priceLevels: ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE'],
    aggregateSearch: async ({ includePlaceIds, priceLevels }) => {
      const ids = buckets[priceLevels[0]] || [];
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
    routeMatrixCompute: async ({ placeId }) => {
      const outside = placeId.startsWith('f') && Number(placeId.slice(1)) > 5;
      return { routingSummary: { legs: [{ duration: outside ? '900s' : '300s' }] } };
    },
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.topK.length, 20);
  assert.equal(result.topK.filter((candidate) => candidate.priceLevel === 'PRICE_LEVEL_FREE').length, 5);
  assert.equal(result.topK.filter((candidate) => candidate.priceLevel === 'PRICE_LEVEL_INEXPENSIVE').length, 15);
  assert.equal(result.proof.hardTravelConstraint, true);
  assert.ok(result.topK.every((candidate) => candidate.travelTimeSeconds <= 600));
});
