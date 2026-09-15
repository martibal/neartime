'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AGGREGATE_ENDPOINT,
  AGGREGATE_MAX_POLYGON_VERTICES,
  NEARBY_ENDPOINT,
  PLACE_DETAILS_BASE,
  SKU,
  createGoogleCoverageProvider,
  validatePolygon,
} = require('./lib/googleCoverageProvider');

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

test('Aggregate count request does not ask for place ids', async () => {
  const calls = [];
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Drive',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ count: '42' });
    },
  });

  const result = await provider.aggregateSearch({
    circle: { center: { latitude: 59.91, longitude: 10.75 }, radius: 1500 },
    includedTypes: ['grocery_store'],
    includePlaceIds: false,
  });

  assert.equal(calls[0].url, AGGREGATE_ENDPOINT);
  assert.deepEqual(calls[0].body.insights, ['INSIGHT_COUNT']);
  assert.deepEqual(calls[0].body.filter.typeFilter.includedTypes, ['grocery_store']);
  assert.equal(result.count, 42);
  assert.deepEqual(result.placeIds, []);
});

test('Aggregate leaf request asks for count and place ids', async () => {
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.insights, ['INSIGHT_COUNT', 'INSIGHT_PLACES']);
      return jsonResponse({ count: '2', placeInsights: [{ place: 'places/a' }, { place: 'places/b' }] });
    },
  });

  const result = await provider.aggregateSearch({
    circle: { center: { latitude: 59.91, longitude: 10.75 }, radius: 500 },
    includedTypes: ['cafe'],
    includePlaceIds: true,
  });

  assert.equal(result.count, 2);
  assert.deepEqual(result.placeIds, ['places/a', 'places/b']);
});

test('Aggregate polygon request emits customArea coordinates in latitude-longitude form', async () => {
  const calls = [];
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return jsonResponse({ count: '2', placeInsights: [{ place: 'places/a' }, { place: 'places/b' }] });
    },
  });

  const clockwiseRing = [
    [10.75, 59.91],
    [10.75, 59.92],
    [10.76, 59.92],
    [10.76, 59.91],
    [10.75, 59.91],
  ];

  const result = await provider.aggregateSearch({
    polygon: clockwiseRing,
    includedTypes: ['cafe'],
    includePlaceIds: true,
  });

  assert.equal(calls[0].url, AGGREGATE_ENDPOINT);
  const customArea = calls[0].body.filter.locationFilter.customArea;
  assert.ok(customArea);
  assert.equal(calls[0].body.filter.locationFilter.circle, undefined);
  assert.equal(customArea.polygon.coordinates.length, 5);
  assert.deepEqual(customArea.polygon.coordinates[0], { latitude: 59.91, longitude: 10.75 });
  assert.equal(result.count, 2);
  assert.deepEqual(result.placeIds, ['places/a', 'places/b']);

  const normalized = validatePolygon(clockwiseRing);
  let signedArea = 0;
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const [x1, y1] = normalized[index];
    const [x2, y2] = normalized[index + 1];
    signedArea += (x1 * y2) - (x2 * y1);
  }
  assert.ok(signedArea > 0, 'provider must send customArea vertices counter-clockwise');
});

test('Aggregate requires exactly one location shape', async () => {
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Walk',
    fetchImpl: async () => jsonResponse({ count: '0' }),
  });

  const polygon = [[10.75, 59.91], [10.76, 59.91], [10.76, 59.92], [10.75, 59.91]];
  await assert.rejects(
    provider.aggregateSearch({ includedTypes: ['cafe'], includePlaceIds: false }),
    /aggregate_requires_exactly_one_location_shape/,
  );
  await assert.rejects(
    provider.aggregateSearch({
      circle: { center: { latitude: 59.91, longitude: 10.75 }, radius: 500 },
      polygon,
      includedTypes: ['cafe'],
      includePlaceIds: false,
    }),
    /aggregate_requires_exactly_one_location_shape/,
  );
});

test('Polygon validation rejects open and oversized rings', () => {
  assert.throws(
    () => validatePolygon([[10.75, 59.91], [10.76, 59.91], [10.76, 59.92], [10.75, 59.92]]),
    /polygon_must_be_closed/,
  );

  const oversized = [];
  for (let index = 0; index < AGGREGATE_MAX_POLYGON_VERTICES; index += 1) {
    oversized.push([10 + (index * 0.000001), 59.9]);
  }
  oversized.push([...oversized[0]]);
  assert.throws(() => validatePolygon(oversized), /aggregate_polygon_vertex_limit_exceeded/);
});

test('Nearby uses traffic-aware optimal for Drive and routing summaries', async () => {
  const calls = [];
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Drive',
    fetchImpl: async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return jsonResponse({ places: [], routingSummaries: [] });
    },
  });

  await provider.nearbySearch({
    circle: { center: { latitude: 59.92, longitude: 10.76 }, radius: 1000 },
    includedTypes: ['restaurant'],
    maxResultCount: 20,
  });

  assert.equal(calls[0].url, NEARBY_ENDPOINT);
  assert.equal(calls[0].body.routingParameters.travelMode, 'DRIVE');
  assert.equal(calls[0].body.routingParameters.routingPreference, 'TRAFFIC_AWARE_OPTIMAL');
  assert.match(calls[0].init.headers['X-Goog-FieldMask'], /routingSummaries/);
});

test('Place Details fallback uses Enterprise fields and exact place id', async () => {
  const calls = [];
  const provider = createGoogleCoverageProvider({
    apiKey: 'test-key',
    origin: { latitude: 59.91, longitude: 10.75 },
    travelMode: 'Bike',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: 'abc', rating: 4.2, userRatingCount: 50 });
    },
  });

  const result = await provider.placeDetails({ placeId: 'places/abc' });
  assert.equal(calls[0].url, `${PLACE_DETAILS_BASE}/abc`);
  assert.equal(calls[0].init.method, 'GET');
  assert.match(calls[0].init.headers['X-Goog-FieldMask'], /currentOpeningHours/);
  assert.equal(result.id, 'abc');
});

test('SKU constants match the versioned billing contract', () => {
  assert.equal(SKU.AGGREGATE, '546C-66B2-E5A6');
  assert.equal(SKU.NEARBY_ENTERPRISE_ATMOSPHERE, 'F20E-7034-0EF7');
  assert.equal(SKU.PLACE_DETAILS_ENTERPRISE, '2D9A-3DE0-3766');
});
