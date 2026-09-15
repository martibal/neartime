'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COVERAGE_STATE,
  RESULT_STATUS,
  runCoverageSearch,
} = require('./lib/coverageOrchestrator');

const origin = { latitude: 59.91, longitude: 10.75 };

function makeAggregate(ids) {
  return async ({ includePlaceIds }) => includePlaceIds
    ? ({ count: ids.length, placeIds: ids })
    : ({ count: ids.length });
}

test('coverage flow records observed Nearby plus Details economics', async () => {
  const result = await runCoverageSearch({
    origin,
    radiusMeters: 1000,
    categoryTypes: ['cafe'],
    searchKey: 'economics-observed-0001',
    aggregateSearch: makeAggregate(['a', 'b']),
    nearbySearch: async () => ({ places: [{ id: 'a' }] }),
    placeDetails: async ({ placeId }) => ({ id: placeId }),
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.equal(result.providerCalls.nearbyCalls, 1);
  assert.equal(result.providerCalls.fallbackCalls, 1);
  assert.equal(result.retrievalEconomics.length, 1);
  assert.equal(result.retrievalEconomics[0].missingCount, 1);
  assert.equal(result.retrievalEconomics[0].currentPathMicroUsd, 60000);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision, null);
});

test('economically attractive adaptive Nearby stage fails closed until implemented', async () => {
  let fallbackCalls = 0;
  const result = await runCoverageSearch({
    origin,
    radiusMeters: 1000,
    categoryTypes: ['cafe'],
    searchKey: 'economics-failclosed-0001',
    options: { adaptiveNearbyStageCalls: 1 },
    aggregateSearch: makeAggregate(['a', 'b', 'c', 'd']),
    nearbySearch: async () => ({ places: [{ id: 'a' }] }),
    placeDetails: async ({ placeId }) => {
      fallbackCalls += 1;
      return { id: placeId };
    },
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.DEGRADED);
  assert.equal(result.coverageState, COVERAGE_STATE.UNVERIFIED);
  assert.match(result.coverageReason, /adaptive_nearby_stage_not_implemented/);
  assert.equal(fallbackCalls, 0);
  assert.equal(result.providerCalls.fallbackCalls, 0);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision.escalate, true);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision.fallbackNowMicroUsd, 60000);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision.nextStageMicroUsd, 40000);
});

test('planner chooses Details when proposed Nearby stage is not strictly cheaper', async () => {
  const fallbackIds = [];
  const result = await runCoverageSearch({
    origin,
    radiusMeters: 1000,
    categoryTypes: ['cafe'],
    searchKey: 'economics-details-0001',
    options: { adaptiveNearbyStageCalls: 1 },
    aggregateSearch: makeAggregate(['a', 'b', 'c']),
    nearbySearch: async () => ({ places: [{ id: 'a' }] }),
    placeDetails: async ({ placeId }) => {
      fallbackIds.push(placeId);
      return { id: placeId };
    },
    applyHardFilters: (places) => places,
  });

  assert.equal(result.resultStatus, RESULT_STATUS.COMPLETE);
  assert.equal(result.coverageState, COVERAGE_STATE.VERIFIED_CURRENT);
  assert.deepEqual(fallbackIds, ['b', 'c']);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision.escalate, false);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision.fallbackNowMicroUsd, 40000);
  assert.equal(result.retrievalEconomics[0].adaptiveDecision.nextStageMicroUsd, 40000);
});
