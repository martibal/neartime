'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COVERAGE_STATE,
  RESULT_STATUS,
  SKU,
  runCoverageSearch,
  splitCircle,
} = require('./lib/coverageOrchestrator');

function makeOrigin() {
  return { latitude: 59.91, longitude: 10.75 };
}

function aggregateFromMap(map) {
  return async ({ circle, includePlaceIds }) => {
    const key = `${circle.center.latitude.toFixed(6)}:${circle.center.longitude.toFixed(6)}:${circle.radius.toFixed(1)}`;
    const entry = map.get(key) || { count: 0, ids: [] };
    return includePlaceIds ? { count: entry.count, placeIds: entry.ids } : { count: entry.count };
  };
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
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds
      ? ({ count: 2, placeIds: ['places/a', 'places/b'] })
      : ({ count: 2 }),
    nearbySearch: async () => ({ places: [{ id: 'a' }, { id: 'b' }] }),
    placeDetails: async () => { throw new Error('fallback not expected'); },
    applyHardFilters: (places) => places,
    hooks: {
      beforeProviderCall: async (step) => { calls.push(step); return `r-${calls.length}`; },
      afterProviderCall: async () => {},
    },
  });

  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 2);
  assert.equal(result.retrievedCount, 2);
  assert.equal(result.providerCalls.aggregateCalls, 2);
  assert.equal(result.providerCalls.nearbyCalls, 1);
  assert.deepEqual(calls.map((x) => x.kind), ['aggregate_count', 'aggregate_places', 'nearby']);
  assert.equal(calls[0].skuId, SKU.AGGREGATE);
  assert.equal(calls[2].skuId, SKU.NEARBY_ENTERPRISE_ATMOSPHERE);
});

test('zero Aggregate count is VERIFIED_CURRENT NO_MATCHES without Nearby call', async () => {
  let nearbyCalls = 0;
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['cafe'],
    searchKey: 'search-empty-0001',
    aggregateSearch: async () => ({ count: 0 }),
    nearbySearch: async () => { nearbyCalls += 1; return { places: [] }; },
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.NO_MATCHES);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 0);
  assert.equal(result.retrievedCount, 0);
  assert.equal(nearbyCalls, 0);
  assert.equal(result.providerCalls.aggregateCalls, 1);
});

test('missing Nearby candidate is recovered through targeted details fallback', async () => {
  const fallbackIds = [];
  const steps = [];
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['grocery_store'],
    searchKey: 'search-fallback-0001',
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds
      ? ({ count: 2, placeIds: ['a', 'b'] })
      : ({ count: 2 }),
    nearbySearch: async () => ({ places: [{ id: 'a' }] }),
    placeDetails: async ({ placeId }) => { fallbackIds.push(placeId); return { id: placeId }; },
    applyHardFilters: (places) => places,
    hooks: {
      beforeProviderCall: async (step) => { steps.push(step); return step.idempotencyKey; },
      afterProviderCall: async () => {},
    },
  });

  assert.deepEqual(fallbackIds, ['b']);
  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.providerCalls.fallbackCalls, 1);
  assert.equal(steps.at(-1).kind, 'details');
  assert.equal(steps.at(-1).skuId, SKU.PLACE_DETAILS_ENTERPRISE);
});

test('incomplete Aggregate Place ID witness cannot produce COMPLETE', async () => {
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['restaurant'],
    searchKey: 'search-degraded-0001',
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds
      ? ({ count: 3, placeIds: ['a', 'b'] })
      : ({ count: 3 }),
    nearbySearch: async () => ({ places: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }),
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageState, COVERAGE_STATE.UNVERIFIED);
  assert.match(result.coverageReason, /aggregate_place_ids_incomplete/);
});

test('Aggregate enumerates exactly 100 Place IDs without partitioning', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `p${index + 1}`);
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1200,
    categoryTypes: ['cafe'],
    searchKey: 'search-hundred-0001',
    aggregateSearch: async ({ includePlaceIds }) => includePlaceIds
      ? ({ count: 100, placeIds: ids })
      : ({ count: 100 }),
    nearbySearch: async () => ({ places: ids.map((id) => ({ id })) }),
    placeDetails: async () => { throw new Error('fallback not expected'); },
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 100);
  assert.equal(result.retrievedCount, 100);
  assert.equal(result.providerCalls.aggregateCalls, 2);
  assert.equal(result.providerCalls.nearbyCalls, 1);
});

test('dense root above 100 uses count-only first and splits before requesting Place IDs', async () => {
  const root = { center: makeOrigin(), radius: 2000 };
  const children = splitCircle(root);
  const map = new Map();
  const key = (c) => `${c.center.latitude.toFixed(6)}:${c.center.longitude.toFixed(6)}:${c.radius.toFixed(1)}`;
  map.set(key(root), { count: 101, ids: [] });
  children.forEach((child, index) => map.set(key(child), { count: 1, ids: [`p${index + 1}`] }));

  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 2000,
    categoryTypes: ['cafe'],
    searchKey: 'search-split-0001',
    options: { maxDepth: 2, maxAggregateCalls: 16, maxNearbyCalls: 8 },
    aggregateSearch: aggregateFromMap(map),
    nearbySearch: async ({ circle }) => {
      const entry = map.get(key(circle));
      return { places: (entry?.ids || []).map((id) => ({ id })) };
    },
    placeDetails: async ({ placeId }) => ({ id: placeId }),
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.expectedCount, 4);
  assert.equal(result.providerCalls.aggregateCalls, 9); // root count + 4 child counts + 4 child ID witnesses
});

test('partition depth exhaustion yields DEGRADED instead of false completeness', async () => {
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 2000,
    categoryTypes: ['restaurant'],
    searchKey: 'search-depth-0001',
    options: { maxDepth: 0, maxAggregateCalls: 2, maxNearbyCalls: 2 },
    aggregateSearch: async () => ({ count: 101 }),
    nearbySearch: async () => ({ places: [{ id: 'partial' }] }),
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageState, COVERAGE_STATE.UNVERIFIED);
  assert.match(result.coverageReason, /partition_depth_exhausted/);
});

test('Aggregate call budget exhaustion fails degraded without exceeding cap', async () => {
  let aggregateCalls = 0;
  const result = await runCoverageSearch({
    origin: makeOrigin(),
    radiusMeters: 1000,
    categoryTypes: ['restaurant'],
    searchKey: 'search-budget-0001',
    options: { maxAggregateCalls: 1, maxNearbyCalls: 1 },
    aggregateSearch: async ({ includePlaceIds }) => {
      aggregateCalls += 1;
      return includePlaceIds ? { count: 1, placeIds: ['a'] } : { count: 1 };
    },
    nearbySearch: async () => ({ places: [] }),
    placeDetails: async () => null,
    applyHardFilters: (places) => places,
  });

  assert.equal(aggregateCalls, 1);
  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageReason, 'aggregate_call_budget_exhausted');
});
