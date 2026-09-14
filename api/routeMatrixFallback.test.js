'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ROUTE_MATRIX_ENDPOINT,
  ROUTE_MATRIX_SKU,
  createRouteMatrixFallback,
  enrichFallbackPlaceWithRoute,
  routeMatrixSkuForTravelMode,
} = require('./lib/routeMatrixFallback');

function okMatrix(duration = '600s', distanceMeters = 1200) {
  return {
    ok: true,
    status: 200,
    async json() {
      return [{
        originIndex: 0,
        destinationIndex: 0,
        status: {},
        condition: 'ROUTE_EXISTS',
        duration,
        distanceMeters,
      }];
    },
    async text() { return ''; },
  };
}

test('Drive fallback uses Pro SKU and traffic-aware optimal routing', async () => {
  const calls = [];
  const routeMatrix = createRouteMatrixFallback({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Drive',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return okMatrix();
    },
  });

  const result = await routeMatrix.compute({ placeId: 'places/place-1' });
  assert.equal(routeMatrix.skuId, ROUTE_MATRIX_SKU.PRO);
  assert.equal(calls[0].url, ROUTE_MATRIX_ENDPOINT);
  assert.equal(calls[0].body.travelMode, 'DRIVE');
  assert.equal(calls[0].body.routingPreference, 'TRAFFIC_AWARE_OPTIMAL');
  assert.equal(calls[0].body.destinations[0].waypoint.placeId, 'place-1');
  assert.equal(result.routingSummary.legs[0].duration, '600s');
  assert.equal(result.routingSummary.legs[0].distanceMeters, 1200);
});

test('Walk and Bike fallback use Essentials SKU without driving routing preference', () => {
  assert.equal(routeMatrixSkuForTravelMode('Walk'), ROUTE_MATRIX_SKU.ESSENTIALS);
  assert.equal(routeMatrixSkuForTravelMode('Bike'), ROUTE_MATRIX_SKU.ESSENTIALS);
  assert.equal(routeMatrixSkuForTravelMode('Drive'), ROUTE_MATRIX_SKU.PRO);
});

test('fallback enrichment reserves and settles Route Matrix before returning routed place', async () => {
  const events = [];
  const hooks = {
    beforeProviderCall: async (step) => {
      events.push(['reserve', step.kind, step.skuId, step.quantity]);
      return { reservationId: 'route-reservation-1' };
    },
    afterProviderCall: async (step) => {
      events.push(['settle', step.kind, step.outcome]);
    },
  };
  const routeMatrix = {
    skuId: ROUTE_MATRIX_SKU.PRO,
    compute: async () => ({
      routingSummary: { legs: [{ duration: '420s', distanceMeters: 900 }] },
    }),
  };

  const enriched = await enrichFallbackPlaceWithRoute({
    place: { id: 'place-1', rating: 4.5 },
    placeId: 'place-1',
    searchKey: 'search-v2-test-0001',
    hooks,
    routeMatrix,
  });

  assert.deepEqual(events, [
    ['reserve', 'route_matrix', ROUTE_MATRIX_SKU.PRO, 1],
    ['settle', 'route_matrix', 'succeeded'],
  ]);
  assert.equal(enriched.__routingSummary.legs[0].duration, '420s');
});
