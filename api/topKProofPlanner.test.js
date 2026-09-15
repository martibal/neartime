'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMPLETE_TOP_K,
  DEGRADED,
  RANKING_MODE,
  estimateTopKWorstCase,
  proveTopK,
  proveTopKByPrice,
  proveTopKByRating,
  proveTopKByTravelTime,
} = require('./lib/topKProofPlanner');

function polygon() {
  return [[10.75, 59.91], [10.76, 59.91], [10.76, 59.92], [10.75, 59.92], [10.75, 59.91]];
}

function envelope(minutes) {
  return {
    polygonCount: 1,
    discardedHoleCount: 0,
    polygons: [[
      { latitude: 59.91, longitude: 10.75 },
      { latitude: 59.91, longitude: 10.76 },
      { latitude: 59.92, longitude: 10.76 },
      { latitude: 59.92, longitude: 10.75 },
      { latitude: 59.91, longitude: 10.75 },
    ]],
    maxMinutes: minutes,
  };
}

test('rating proof keeps exact five-star ties detail-free', async () => {
  const ids = Array.from({ length: 36 }, (_, index) => `p${String(index + 1).padStart(2, '0')}`);
  let details = 0;
  const result = await proveTopKByRating({
    polygon: polygon(), includedTypes: ['restaurant'],
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      assert.equal(ratingFilter.minRating, 5);
      return includePlaceIds ? { count: 36, placeIds: ids } : { count: 36 };
    },
    placeDetails: async () => { details += 1; return { rating: 5 }; },
  });
  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.topK.length, 20);
  assert.equal(result.aggregateCalls, 2);
  assert.equal(result.detailCalls, 0);
  assert.equal(details, 0);
  assert.equal(result.proof.tiePolicy, 'RATING_TIES_EQUIVALENT');
});

test('price proof walks exact price buckets and needs no Details for proof', async () => {
  const buckets = {
    PRICE_LEVEL_FREE: ['f1', 'f2'],
    PRICE_LEVEL_INEXPENSIVE: Array.from({ length: 22 }, (_, index) => `i${index + 1}`),
  };
  const result = await proveTopKByPrice({
    polygon: polygon(), includedTypes: ['cafe'],
    aggregateSearch: async ({ includePlaceIds, priceLevels }) => {
      const ids = buckets[priceLevels[0]] || [];
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
  });
  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.topK.length, 20);
  assert.equal(result.topK[0].priceLevel, 'PRICE_LEVEL_FREE');
  assert.equal(result.topK[2].priceLevel, 'PRICE_LEVEL_INEXPENSIVE');
  assert.equal(result.aggregateCalls, 4);
  assert.equal(result.detailCalls, 0);
  assert.equal(result.proof.unknownPricePolicy, 'EXCLUDED_FROM_PRICE_RANKING');
});

test('price proof fails closed before materializing an oversized tied bucket', async () => {
  const result = await proveTopKByPrice({
    polygon: polygon(), includedTypes: ['restaurant'],
    aggregateSearch: async ({ priceLevels }) => ({ count: priceLevels[0] === 'PRICE_LEVEL_FREE' ? 120 : 0 }),
  });
  assert.equal(result.status, DEGRADED);
  assert.equal(result.reason, 'price_bucket_candidate_cap_exceeded');
  assert.equal(result.aggregateCalls, 1);
});

test('travel-time proof expands isochrones, routes only the first proof-worthy envelope and sorts exact durations', async () => {
  const counts = new Map([[3, 5], [5, 14], [7, 31]]);
  let currentThreshold = null;
  const ids = Array.from({ length: 31 }, (_, index) => `p${index + 1}`);
  const result = await proveTopKByTravelTime({
    envelopeProvider: {
      async getEnvelope({ maxMinutes }) { currentThreshold = maxMinutes; return envelope(maxMinutes); },
    },
    aggregateSearch: async ({ includePlaceIds }) => {
      const count = counts.get(currentThreshold) ?? 31;
      return includePlaceIds ? { count, placeIds: ids.slice(0, count) } : { count };
    },
    routeMatrixCompute: async ({ placeId }) => {
      const n = Number(placeId.slice(1));
      return { routingSummary: { legs: [{ duration: `${100 + n}s` }] } };
    },
    origin: { latitude: 59.91, longitude: 10.75 }, travelMode: 'Walk', maxMinutes: 7,
    includedTypes: ['cafe'], travelThresholds: [3, 5, 7],
  });
  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThresholdMinutes, 7);
  assert.equal(result.envelopeCalls, 3);
  assert.equal(result.aggregateCalls, 4);
  assert.equal(result.routeCalls, 31);
  assert.equal(result.topK.length, 20);
});

test('travel-time proof continues when isochrone polygon has false-positive candidates after exact routing', async () => {
  let currentThreshold = null;
  const result = await proveTopKByTravelTime({
    envelopeProvider: { async getEnvelope({ maxMinutes }) { currentThreshold = maxMinutes; return envelope(maxMinutes); } },
    aggregateSearch: async ({ includePlaceIds }) => {
      const count = currentThreshold === 5 ? 21 : 25;
      const ids = Array.from({ length: count }, (_, index) => `p${index + 1}`);
      return includePlaceIds ? { count, placeIds: ids } : { count };
    },
    routeMatrixCompute: async ({ placeId }) => {
      const n = Number(placeId.slice(1));
      const seconds = n <= 18 ? 240 : 360;
      return { routingSummary: { legs: [{ duration: `${seconds}s` }] } };
    },
    origin: { latitude: 59.91, longitude: 10.75 }, travelMode: 'Walk', maxMinutes: 7,
    includedTypes: ['cafe'], travelThresholds: [5, 7],
  });
  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThresholdMinutes, 7);
  assert.equal(result.topK.length, 20);
  assert.equal(result.routeCalls, 25);
});

test('travel-time proof fails closed on holes or multi-polygon envelope', async () => {
  const result = await proveTopKByTravelTime({
    envelopeProvider: { async getEnvelope() { return { ...envelope(5), discardedHoleCount: 1 }; } },
    aggregateSearch: async () => ({ count: 0 }),
    routeMatrixCompute: async () => ({ duration: '1s' }),
    origin: { latitude: 59.91, longitude: 10.75 }, travelMode: 'Walk', maxMinutes: 5,
    includedTypes: ['cafe'], travelThresholds: [5],
  });
  assert.equal(result.status, DEGRADED);
  assert.equal(result.reason, 'travel_time_envelope_not_simple_exact');
});

test('generic dispatcher selects ranking mode and worst-case plans are explicit', async () => {
  const rating = await proveTopK({
    rankingMode: RANKING_MODE.RATING, polygon: polygon(), includedTypes: ['cafe'], k: 1,
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds ? { count: 1, placeIds: ['a'] } : { count: 1 },
    placeDetails: async () => ({ rating: 5 }),
  });
  assert.equal(rating.rankingMode, RANKING_MODE.RATING);

  const price = estimateTopKWorstCase({ rankingMode: RANKING_MODE.PRICE });
  const travel = estimateTopKWorstCase({ rankingMode: RANKING_MODE.TRAVEL_TIME, maxMinutes: 15, maxRouteCalls: 80 });
  assert.equal(price.maxAggregateCalls, 10);
  assert.equal(price.maxFinalistDetailCalls, 20);
  assert.equal(travel.maxRouteElements, 80);
});
