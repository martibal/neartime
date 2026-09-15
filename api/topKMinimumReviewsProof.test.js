'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMPLETE_TOP_K, DEGRADED } = require('./lib/topKProofPlanner');
const {
  provePriceTopKWithMinimumReviews,
  proveRatingTopKWithMinimumReviews,
  proveTravelTimeTopKWithMinimumReviews,
} = require('./lib/topKMinimumReviewsProof');

const POLYGON = [[10.75, 59.91], [10.76, 59.91], [10.76, 59.92], [10.75, 59.92], [10.75, 59.91]];

function route(seconds = 300) {
  return { routingSummary: { legs: [{ duration: `${seconds}s` }] } };
}

test('rating minimum-reviews proof lowers threshold until K review-qualified places are proven', async () => {
  const five = Array.from({ length: 20 }, (_, i) => `f${i + 1}`);
  const lower = Array.from({ length: 20 }, (_, i) => `l${i + 1}`);
  const all = [...five, ...lower];
  const result = await proveRatingTopKWithMinimumReviews({
    polygon: POLYGON,
    includedTypes: ['cafe'],
    maxMinutes: 10,
    minimumReviews: 100,
    k: 20,
    ratingThresholds: [5, 4.9, 1],
    aggregateSearch: async ({ includePlaceIds, ratingFilter }) => {
      const ids = ratingFilter.minRating === 5 ? five : all;
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
    placeDetails: async ({ placeId }) => ({
      id: placeId,
      rating: placeId.startsWith('f') ? 5 : 4.9,
      userRatingCount: placeId.startsWith('f') ? 50 : 200,
    }),
    routeMatrixCompute: async () => route(),
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThreshold, 4.9);
  assert.equal(result.topK.length, 20);
  assert.ok(result.topK.every((candidate) => candidate.userRatingCount >= 100));
  assert.equal(result.proof.minimumReviews, 100);
});

test('price minimum-reviews proof continues to later buckets after filtering low-review places', async () => {
  const free = Array.from({ length: 15 }, (_, i) => `f${i + 1}`);
  const cheap = Array.from({ length: 25 }, (_, i) => `c${i + 1}`);
  const buckets = {
    PRICE_LEVEL_FREE: free,
    PRICE_LEVEL_INEXPENSIVE: cheap,
  };
  const result = await provePriceTopKWithMinimumReviews({
    polygon: POLYGON,
    includedTypes: ['cafe'],
    maxMinutes: 10,
    minimumReviews: 100,
    k: 20,
    priceLevels: ['PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE'],
    aggregateSearch: async ({ includePlaceIds, priceLevels }) => {
      const ids = buckets[priceLevels[0]] || [];
      return includePlaceIds ? { count: ids.length, placeIds: ids } : { count: ids.length };
    },
    placeDetails: async ({ placeId }) => ({
      id: placeId,
      userRatingCount: placeId.startsWith('f') ? 50 : 300,
      priceLevel: placeId.startsWith('f') ? 'PRICE_LEVEL_FREE' : 'PRICE_LEVEL_INEXPENSIVE',
    }),
    routeMatrixCompute: async () => route(),
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.topK.length, 20);
  assert.ok(result.topK.every((candidate) => candidate.userRatingCount >= 100));
  assert.ok(result.topK.every((candidate) => candidate.priceLevel === 'PRICE_LEVEL_INEXPENSIVE'));
});

test('travel-time minimum-reviews proof expands envelope when nearer places do not meet review floor', async () => {
  const near = Array.from({ length: 25 }, (_, i) => `n${i + 1}`);
  const far = Array.from({ length: 20 }, (_, i) => `f${i + 1}`);
  const envelopeProvider = {
    async getEnvelope({ maxMinutes }) {
      return {
        polygonCount: 1,
        discardedHoleCount: 0,
        polygons: [POLYGON.map(([longitude, latitude]) => ({ longitude, latitude }))],
        maxMinutes,
      };
    },
  };
  const result = await proveTravelTimeTopKWithMinimumReviews({
    envelopeProvider,
    origin: { latitude: 59.9139, longitude: 10.7522 },
    travelMode: 'Walk',
    maxMinutes: 10,
    travelThresholds: [5],
    includedTypes: ['cafe'],
    minimumReviews: 100,
    k: 20,
    aggregateSearch: async ({ includePlaceIds }) => {
      const callsAtFive = includePlaceIds ? null : null;
      void callsAtFive;
      return includePlaceIds
        ? { count: [...near, ...far].length, placeIds: [...near, ...far] }
        : { count: [...near, ...far].length };
    },
    placeDetails: async ({ placeId }) => ({
      id: placeId,
      userRatingCount: placeId.startsWith('n') ? 50 : 200,
    }),
    routeMatrixCompute: async ({ placeId }) => route(placeId.startsWith('n') ? 240 : 480),
  });

  assert.equal(result.status, COMPLETE_TOP_K);
  assert.equal(result.selectedThresholdMinutes, 10);
  assert.equal(result.topK.length, 20);
  assert.ok(result.topK.every((candidate) => candidate.userRatingCount >= 100));
  assert.ok(result.topK.every((candidate) => candidate.travelTimeSeconds <= 600));
});

test('minimum-reviews proof fails closed when proving the filter would exceed the detail budget', async () => {
  const ids = Array.from({ length: 60 }, (_, i) => `p${i + 1}`);
  const result = await provePriceTopKWithMinimumReviews({
    polygon: POLYGON,
    includedTypes: ['restaurant'],
    maxMinutes: 10,
    minimumReviews: 100,
    k: 20,
    maxDetailCalls: 50,
    priceLevels: ['PRICE_LEVEL_INEXPENSIVE'],
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds
      ? { count: ids.length, placeIds: ids }
      : { count: ids.length },
    placeDetails: async ({ placeId }) => ({ id: placeId, userRatingCount: 200 }),
    routeMatrixCompute: async () => route(),
  });

  assert.equal(result.status, DEGRADED);
  assert.equal(result.reason, 'minimum_reviews_detail_budget_exhausted');
});
