'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COVERAGE_STATE,
  RESULT_STATUS,
  runCoverageSearch,
  splitCircle,
} = require('./lib/coverageOrchestrator');

function makeOrigin() {
  return { latitude: 59.91, longitude: 10.75 };
}

test('splitCircle creates four covering child circles', () => {
  const parent = { center: makeOrigin(), radius: 1000 };
  const children = splitCircle(parent);
  assert.equal(children.length, 4);
  for (const child of children) {
    assert.ok(child.radius < parent.radius);
    assert.ok(child.radius > 700 && child.radius < 710);
  }
});

test('verified current candidate universe returns COMPLETE', async () => {
  const calls = [];
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1500,
    categoryTypes: ['grocery_store'],
    searchKey: 'search-verified-0001',
    aggregateSearch: async () => ({ count: 2, placeIds: ['places/a', 'places/b'] }),
    nearbySearch: async () => ({ places: [{ id: 'a', rating: 4.1 }, { id: 'b', rating: 4.3 }] }),
    placeDetails: async () => { throw new Error('fallback not expected'); },
    applyHardFilters: (places) => places,
    hooks: {
      beforeProviderCall: async (step) => { calls.push(['before', step.kind, step.idempotencyKey]); return `r-${calls.length}`; },
      afterProviderCall: async (step) => { calls.push(['after', step.kind, step.outcome]); },
    },
  });

  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.retrievedCount, 2);
  assert.equal(result.places.length, 2);
  assert.equal(result.providerCalls.aggregateCalls, 1);
  assert.equal(result.providerCalls.nearbyCalls, 1);
  assert.equal(result.providerCalls.fallbackCalls, 0);
  assert.equal(calls[0][1], 'aggregate');
  assert.equal(calls[2][1], 'nearby');
});

test('verified empty filtered result returns NO_MATCHES, never DEGRADED', async () => {
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['cafe'],
    searchKey: 'search-empty-0001',
    aggregateSearch: async () => ({ count: 1, placeIds: ['p1'] }),
    nearbySearch: async () => ({ places: [{ id: 'p1', rating: 2.0 }] }),
    placeDetails: async () => null,
    applyHardFilters: () => [],
  });

  assert.equal(result.resultStatus, RESULT_STATUS.NO_MATCHES);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 1);
  assert.equal(result.retrievedCount, 1);
});

test('missing Nearby candidate is recovered through targeted details fallback', async () => {
  const fallbackIds = [];
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['grocery_store'],
    searchKey: 'search-fallback-0001',
    aggregateSearch: async () => ({ count: 2, placeIds: ['a', 'b'] }),
    nearbySearch: async () => ({ places: [{ id: 'a', rating: 4.0 }] }),
    placeDetails: async ({ placeId }) => {
      fallbackIds.push(placeId);
      return { id: placeId, rating: 4.2 };
    },
    applyHardFilters: (places) => places,
  });

  assert.deepEqual(fallbackIds, ['b']);
  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.providerCalls.fallbackCalls, 1);
  assert.equal(result.retrievedCount, 2);
});

test('Aggregate count without complete Place IDs cannot produce COMPLETE', async () => {
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['restaurant'],
    searchKey: 'search-degraded-0001',
    aggregateSearch: async () => ({ count: 3, placeIds: ['a', 'b'] }),
    nearbySearch: async () => ({ places: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageState, COVERAGE_STATE.UNVERIFIED);
  assert.match(result.coverageReason, /aggregate_place_ids_incomplete/);
});

test('dense cells split until leaf counts are within target', async () => {
  let aggregateCalls = 0;
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 2000,
    categoryTypes: ['cafe'],
    searchKey: 'search-split-0001',
    options: { maxDepth: 2, maxAggregateCalls: 8, maxNearbyCalls: 8 },
    aggregateSearch: async () => {
      aggregateCalls += 1;
      if (aggregateCalls === 1) return { count: 40, placeIds: [] };
      const id = `p${aggregateCalls}`;
      return { count: 1, placeIds: [id] };
    },
    nearbySearch: async ({ stepKey }) => {
      const match = /n(\d+):/.exec(stepKey);
      const ordinal = Number(match?.[1] ?? 0);
      return { places: [{ id: `p${ordinal + 1}` }] };
    },
    placeDetails: async ({ placeId }) => ({ id: placeId }),
    applyHardFilters: (places) => places,
  });

  assert.equal(aggregateCalls, 5);
  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 4);
});

test('partition depth exhaustion yields DEGRADED instead of false completeness', async () => {
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 2000,
    categoryTypes: ['restaurant'],
    searchKey: 'search-depth-0001',
    options: { maxDepth: 0, maxAggregateCalls: 2, maxNearbyCalls: 2 },
    aggregateSearch: async () => ({ count: 50, placeIds: [] }),
    nearbySearch: async () => ({ places: [{ id: 'partial' }] }),
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageState, COVERAGE_STATE.UNVERIFIED);
  assert.match(result.coverageReason, /partition_depth_exhausted/);
});

test('provider call budget exhaustion fails degraded without exceeding cap', async () => {
  let aggregateCalls = 0;
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 2000,
    categoryTypes: ['restaurant'],
    searchKey: 'search-budget-0001',
    options: { maxDepth: 5, maxAggregateCalls: 1, maxNearbyCalls: 1 },
    aggregateSearch: async () => { aggregateCalls += 1; return { count: 50, placeIds: [] }; },
    nearbySearch: async () => ({ places: [] }),
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(aggregateCalls, 1);
  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageState, COVERAGE_STATE.UNVERIFIED);
  assert.equal(result.coverageReason, 'aggregate_call_budget_exhausted');
});
