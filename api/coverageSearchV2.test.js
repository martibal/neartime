'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { attachRoutingSummaries, filterCandidates, runCoverageSearchV2 } = require('./lib/coverageSearchV2');

function query() {
  return {
    category: 'Grocery',
    travelMode: 'Drive',
    maxMinutes: 20,
    minimumRating: 4.0,
    minimumReviews: 100,
    openNow: false,
    openForMinutes: 0,
  };
}

function origin() {
  return { latitude: 59.91, longitude: 10.75 };
}

test('fail-closed activation blocks before any provider or wallet work', async () => {
  let rpcCalls = 0;
  let fetchCalls = 0;
  await assert.rejects(
    runCoverageSearchV2({
      activation: { enabled: false, geometryVerified: false },
      apiKey: 'key',
      entitlementHash: 'entitlement-1',
      deviceId: 'device-1',
      supabaseRpc: async () => { rpcCalls += 1; },
      origin: origin(),
      query: query(),
      radiusMeters: 1000,
      searchKey: 'search-v2-0001',
      fetchImpl: async () => { fetchCalls += 1; },
    }),
    (error) => error.code === 'coverage_v2_disabled',
  );
  assert.equal(rpcCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('geometry must be explicitly verified even when v2 is enabled', async () => {
  await assert.rejects(
    runCoverageSearchV2({
      activation: { enabled: true, geometryVerified: false },
      apiKey: 'key',
      entitlementHash: 'entitlement-1',
      deviceId: 'device-1',
      supabaseRpc: async () => { throw new Error('must not call RPC'); },
      origin: origin(),
      query: query(),
      radiusMeters: 1000,
      searchKey: 'search-v2-0002',
      fetchImpl: async () => { throw new Error('must not call provider'); },
    }),
    (error) => error.code === 'coverage_geometry_not_verified',
  );
});

test('routing summaries are attached by place index and hard filters use route time', () => {
  const payload = attachRoutingSummaries({
    places: [{
      id: 'a', displayName: { text: 'A' }, formattedAddress: 'Street',
      location: { latitude: 59.911, longitude: 10.751 }, rating: 4.3, userRatingCount: 200,
      currentOpeningHours: { openNow: true },
    }],
    routingSummaries: [{ legs: [{ duration: '600s', distanceMeters: 1200 }] }],
  });
  const result = filterCandidates(payload.places, origin(), query());
  assert.equal(result.unresolvedIds.length, 0);
  assert.equal(result.places.length, 1);
  assert.equal(result.places[0].driveMinutes, 10);
});

test('candidate without routing data is unresolved instead of silently passing or failing', () => {
  const result = filterCandidates([{ id: 'fallback', rating: 4.5, userRatingCount: 300 }], origin(), query());
  assert.deepEqual(result.unresolvedIds, ['fallback']);
  assert.equal(result.places.length, 0);
});

test('provider COGS denial is propagated as an economic gate instead of a fake DEGRADED result', async () => {
  let providerCalls = 0;
  await assert.rejects(
    runCoverageSearchV2({
      activation: { enabled: true, geometryVerified: true },
      apiKey: 'key',
      entitlementHash: 'entitlement-1',
      deviceId: 'device-1',
      supabaseRpc: async (name) => {
        if (name === 'reserve_provider_cogs') return [{ allowed: false, reason: 'provider_budget_exhausted' }];
        throw new Error(`unexpected RPC ${name}`);
      },
      origin: origin(),
      query: query(),
      radiusMeters: 1000,
      searchKey: 'search-v2-0003',
      fetchImpl: async () => { providerCalls += 1; throw new Error('provider must not be called'); },
    }),
    (error) => error.code === 'provider_budget_exhausted',
  );
  assert.equal(providerCalls, 0);
});
